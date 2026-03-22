
// v1.1
// 
import { QdrantClient } from '@qdrant/js-client-rest';
import { getEmbedding } from './llm.js';
// import { pipeline } from 'zod/v3';
import { pipeline, Pipeline } from '@xenova/transformers';

const client = new QdrantClient({ url: 'http://localhost:6333' });
const COLLECTION_NAME = 'aetheros_notes';

/**
 * Initialize Qdrant Collection with Hybrid Support
 */
 
 export const initStorage = async () => {
   const collections = await client.getCollections();
   const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
 
   if (!exists) {
     // 1. Create collection with vectors + sparse support
     await client.createCollection(COLLECTION_NAME, {
       vectors: {
         "text-dense": {
           size: 768,
           distance: 'Cosine'
         }
       },
       sparse_vectors: {
         "text-sparse": {
           index: { full_scan_threshold: 1000 }
         }
       }
     });
 
     console.log(`✅ Collection '${COLLECTION_NAME}' created.`);
 
     // 2. Explicitly create payload indexes (this is the reliable way)
     const fieldsToIndex = [
       { key: "filePath", type: "keyword" },
       { key: "timestamp", type: "datetime" },
       { key: "tags", type: "keyword" },
       { key: "chunkLevel", type: "integer" },
       { key: "headingPath", type: "keyword" }
     ];
 
     for (const field of fieldsToIndex) {
       await client.createPayloadIndex(COLLECTION_NAME, {
         field_name: field.key,
         field_schema: field.type as any
       });
     }
 
     console.log(`✅ All payload indexes created for fast filtering.`);
   }
 };

/**
 * God Plan Upsert — Dense + Sparse + Full Text
 */
 export const upsertChunk = async (
   id: string,
   denseVector: number[],
   // sparseVector: Record<string, number>,   // ← NEW: BM25 sparse vector
   text: string,
   payload: any
 ) => {
   console.log(`📤 Upserting chunk: ${id}`);
   console.log(`   Text length: ${text.length} chars`);
   console.log(`   Payload keys: ${Object.keys(payload).join(', ')}`);
   console.log(`   Heading path: ${payload.headingPath?.join(' → ') || '(none)'}`);
   console.log(`   Chunk level: ${payload.chunkLevel}`);
 
   await client.upsert(COLLECTION_NAME, {
     wait: true,
     points: [
       {
         id,
         vector: {
           "text-dense": denseVector,
           // 🚀 CRITICAL: Satisfy the schema we created in initStorage.
           // This allows you to keep the Watcher simple for now.
           "text-sparse": { indices: [], values: [] }
         },
         payload: {
           ...payload,
           text,                         // Full text for LLM & citations
         },
       },
     ],
   });
 
   console.log(`   ✅ Upserted successfully`);
 };

/**
 * Delete ALL chunks for a specific file (used on CHANGE & unlink)
 */
export const deleteNoteByFilePath = async (filePath: string) => {
  await client.delete(COLLECTION_NAME, {
    filter: {
      must: [{ key: 'filePath', match: { value: filePath } }],
    },
  });
};

/**
 * Legacy single-vector search (keep for now, will upgrade to hybrid later)
 */
export const searchNotes = async (queryVector: number[], limit = 8) => {
  return await client.search(COLLECTION_NAME, {
    vector: queryVector,
    limit,
    with_payload: true,
    with_vector: false,   // Performance
  });
};


//v1.1
// 
/**
 * 🚀 God Plan Hybrid Search (Dense + Sparse + Metadata Filters)
 * This is the real retrieval engine for AetherOS.
 */
// export const hybridSearch = async (
//   queryText: string,
//   limit: number = 8,
//   filter: any = {}   // e.g. { must: [{ key: "timestamp", range: { gt: "2026-01-01" } }] }
// ) => {
//   // 1. Get dense embedding of the user query
//   const denseVector = await getEmbedding(queryText);   // from your llm.js

//     const results = await client.query(COLLECTION_NAME, {
//       query: denseVector,   // raw number[] directly
//       using: "text-dense",
//       limit,
//       with_payload: true,
//       with_vector: false,
//       score_threshold: 0.65
//     } as any);  // ← cast to any to bypass the broken TS types

//   return results.points.map((point: any) => ({
//     id: point.id,
//     score: point.score,
//     text: point.payload.text,
//     headingPath: point.payload.headingPath,
//     filePath: point.payload.filePath,
//     tags: point.payload.tags || [],
//     chunkLevel: point.payload.chunkLevel
//   }));
// };
// 
// 

import { rerank } from "./reranker.js";

export const hybridSearch = async (
  queryText: string,
  limit: number = 12,        // fetch more candidates for reranker to work with
  topK: number = 5,         // final results after reranking
  filter: any = {}
) => {
  console.log(`\n🔍 Hybrid search query: "${queryText}"`);
  console.log(`   Parameters: limit=${limit}, topK=${topK}, filter=${JSON.stringify(filter)}`);

  const denseVector = await getEmbedding(queryText);

  const results = await client.search(COLLECTION_NAME, {
    vector: {
      name: "text-dense",
      vector: denseVector
    },
    limit: 25,                  // fetch limit candidates (e.g. 8-20)
    with_payload: true,
    with_vector: false,
    score_threshold: 0.55,  // lower threshold — reranker will filter further
    ...(Object.keys(filter).length > 0 && { filter })
  });

  console.log(`   Vector search returned ${results.length} candidates`);
  if (results.length > 0) {
    const scores = results.map(r => r.score);
    console.log(`   Score range: min=${Math.min(...scores).toFixed(4)}, max=${Math.max(...scores).toFixed(4)}`);
  }

  const chunks = results.map((point: any) => ({
    id: point.id,
    score: point.score,
    text: point.payload.text,
    headingPath: point.payload.headingPath,
    filePath: point.payload.filePath,
    tags: point.payload.tags || [],
    chunkLevel: point.payload.chunkLevel
  }));

  // Rerank and return topK most relevant
  console.log(`   Sending ${chunks.length} candidates to reranker...`);
  const reranked = await rerank(queryText, chunks, topK);
  console.log(`   Reranker returned ${reranked.length} results (top ${topK})`);

  // Log the final results
  reranked.forEach((r, idx) => {
    console.log(`   [${idx+1}] ID: ${r.id}, Score: ${r.score?.toFixed?.(4) ?? r.score}, Heading: ${r.headingPath?.join(' → ') || '(none)'}`);
  });

  return reranked;
};