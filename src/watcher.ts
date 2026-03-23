// 
// v1.1
// 
import chokidar from 'chokidar';
import matter from 'gray-matter';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEmbedding } from './llm.js';
import { deleteNoteByFilePath, upsertChunk } from './storage.js';
import { getHierarchicalChunks } from './ingest/getHierarchicalChunks.js';

/**
 * v1.1 Ingestion Worker – God Plan Ready
 */
const handleFile = async (filePath: string, type: 'ADD' | 'CHANGE') => {
  if (!filePath.endsWith('.md')) return;

  try {
    console.log(`\n[${type}] 📝 Processing: ${path.basename(filePath)}`);

    // === CLEANUP FIRST (Critical for CHANGE events) ===
    if (type === 'CHANGE') {
      console.log(`   🧹 Cleaning up old chunks for this file...`);
      await deleteNoteByFilePath(filePath);   // Delete ALL old chunks for this file
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const { data, content: body } = matter(content);

    // === 1. Hierarchical Chunks (Structure + Overlap + Auto-Tags) ===
    console.log(`   🔪 Generating hierarchical chunks...`);
    const chunks = await getHierarchicalChunks(body, filePath);
    const sectionChunks = chunks.filter(c => c.chunkLevel === 'section');
    const paragraphChunks = chunks.filter(c => c.chunkLevel === 'paragraph');
    console.log(`   → Generated ${chunks.length} chunks (${sectionChunks.length} sections, ${paragraphChunks.length} paragraphs)`);

    let chunkIndex = 0;
    for (const chunk of chunks) {
      if (chunk.chunkLevel === 'paragraph') {
         console.log(`   🔗 Parent ID for paragraph: ${chunk.parentId}`);
       }
      chunkIndex++;
      console.log(`\n   📦 Chunk ${chunkIndex}/${chunks.length}:`);
      console.log(`      ID: ${chunk.id}`);
      console.log(`      Heading path: ${chunk.headingPath.join(' → ') || '(root)'}`);
      console.log(`      Level: ${chunk.level}`);
      console.log(`      Chunk level: ${chunk.chunkLevel}`);
      console.log(`      Parent ID: ${chunk.parentId || 'none'}`);
      console.log(`      Content length: ${chunk.content.length} chars`);
      if (chunk.tags && chunk.tags.length > 0) {
        console.log(`      Tags: ${chunk.tags.join(', ')}`);
      }
      console.log(`      Content preview: ${chunk.content.substring(0, 100)}${chunk.content.length > 100 ? '…' : ''}`);

      // === 2. Dense Embedding ===
      console.log(`      🔮 Generating embedding...`);
      const vector = await getEmbedding(chunk.content);
      console.log(`      ✅ Embedding generated (dimensions: ${vector.length})`);

      // === 3. Upsert with FULL Metadata (No override of parentId) ===
      console.log(`      💾 Upserting to Qdrant...`);
      await upsertChunk(chunk.id, vector, chunk.content, {
        filePath,
        title: data.title || path.basename(filePath),
        headingPath: chunk.headingPath,
        chunkLevel: chunk.chunkLevel,
        level: chunk.level,           // ← Add the numeric level
        parentId: chunk.parentId,
        timestamp: chunk.timestamp,
        tags: chunk.tags
      });
      console.log(`      ✅ Upserted`);
    }

    console.log(`\n✅ Successfully synced ${chunks.length} chunks from ${path.basename(filePath)}`);

  } catch (error) {
    console.error(`❌ Failed to process ${path.basename(filePath)}:`, error);
  }
};

/**
 * Watcher Setup
 */
export const startWatcher = (folderPath: string) => {
  const watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: false,
  });

  console.log(`👁️ AetherOS Watcher started on: ${path.resolve(folderPath)}`);

  watcher
    .on('add', (p) => handleFile(p, 'ADD'))
    .on('change', (p) => handleFile(p, 'CHANGE'))
    .on('unlink', async (filePath) => {
      if (!filePath.endsWith('.md')) return;
      try {
        await deleteNoteByFilePath(filePath);
        console.log(`🗑️ Cleaned up: ${path.basename(filePath)}`);
      } catch (err) {
        console.error(`❌ Delete failed for ${filePath}:`, err);
      }
    });
};