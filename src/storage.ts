
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
 // export const upsertChunk = async (
 //   id: string,
 //   denseVector: number[],
 //   // sparseVector: Record<string, number>,   // ← NEW: BM25 sparse vector
 //   text: string,
 //   payload: any
 // ) => {
 //   console.log(`   Payload keys: ${Object.keys(payload).join(', ')}`);
 //   console.log(`   parentId in payload: ${payload.parentId}`);
 //   console.log(`📤 Upserting chunk: ${id}`);
 //   console.log(`   Text length: ${text.length} chars`);
 //   console.log(`   Payload keys: ${Object.keys(payload).join(', ')}`);
 //   console.log(`   Heading path: ${payload.headingPath?.join(' → ') || '(none)'}`);
 //   console.log(`   Chunk level: ${payload.chunkLevel}`);
 
 //   await client.upsert(COLLECTION_NAME, {
 //     wait: true,
 //     points: [
 //       {
 //         id,
 //         vector: {
 //           "text-dense": denseVector,
 //           // 🚀 CRITICAL: Satisfy the schema we created in initStorage.
 //           // This allows you to keep the Watcher simple for now.
 //           "text-sparse": { indices: [], values: [] }
 //         },
 //         payload: {
 //           ...payload,
 //           text,                         // Full text for LLM & citations
 //         },
 //       },
 //     ],
 //   });
 
 //   console.log(`   ✅ Upserted successfully`);
 // };
 // 
 import { computeSparseVector } from './services/sparseVector.js';
 
 
 export const upsertChunk = async (
   id: string,
   denseVector: number[],
   text: string,
   payload: any
 ) => {
   const sparseVector = computeSparseVector(text); // synchronous
 
   await client.upsert(COLLECTION_NAME, {
     wait: true,
     points: [{
       id,
       vector: {
         "text-dense": denseVector,
         "text-sparse": sparseVector
       },
       payload: {
         ...payload,
         text,
       },
     }],
   });
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

import { rerank } from "./services/reranker.js";


// 

// export const hybridSearch = async (
//   queryText: string,
//   limit: number = 25, 
//   filter: any = {}
// ) => {
//   const denseVector = await getEmbedding(queryText);

//   const results = await client.search(COLLECTION_NAME, {
//     vector: {
//       name: "text-dense",
//       vector: denseVector
//     },
//     limit,
//     with_payload: true,
//     score_threshold: 0.40, // Let more candidates through for the reranker
//     ...(Object.keys(filter).length > 0 && { filter })
//   });
  
//   results.forEach((point: any) => {
//     console.log(`   Retrieved point ${point.id}: parentId = ${point.payload.parentId}`);
//   });

//   // Return raw chunks without reranking here
//   return results.map((point: any) => ({
//     id: point.id,
//     score: point.score,
//     text: point.payload.text,
//     headingPath: point.payload.headingPath || [],
//     filePath: point.payload.filePath,
//     parentId: point.payload.parentId || null,
//     chunkLevel: point.payload.chunkLevel,
//     tags: point.payload.tags || [],
//   }));
// };




export const hybridSearch = async (
  queryText: string,
  limit: number = 25,
  filter: any = {}
) => {
  const denseVector = await getEmbedding(queryText);
  const querySparse = computeSparseVector(queryText);

  // 1. Dense search (top 100)
  const denseResults = await client.search(COLLECTION_NAME, {
    vector: { name: "text-dense", vector: denseVector },
    limit: 100,
    with_payload: true,
    score_threshold: 0.4,
    ...(Object.keys(filter).length && { filter })
  });

  // 2. Sparse search (top 100)
  const sparseResults = await client.search(COLLECTION_NAME, {
    vector: { name: "text-sparse", vector: querySparse },
    limit: 100,
    with_payload: true,
    score_threshold: 0.1,
    ...(Object.keys(filter).length && { filter })
  });

  // 3. Reciprocal Rank Fusion (RRF)
  const k = 60;
  const scores = new Map<string, { point: any, score: number }>();

  const addResult = (point: any, rank: number, weight: number = 1) => {
    const id = point.id;
    const rrfScore = 1 / (k + rank);
    const existing = scores.get(id);
    if (existing) {
      existing.score += rrfScore * weight;
    } else {
      scores.set(id, { point, score: rrfScore * weight });
    }
  };

  denseResults.forEach((point: any, idx: number) => addResult(point, idx + 1, 1.0));
  sparseResults.forEach((point: any, idx: number) => addResult(point, idx + 1, 1.0));

  // 4. Sort and return top `limit`
  const combined = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ point }) => ({
      id: point.id,
      score: point.score,        // original score, not used later
      text: point.payload.text,
      headingPath: point.payload.headingPath || [],
      filePath: point.payload.filePath,
      parentId: point.payload.parentId || null,
      chunkLevel: point.payload.chunkLevel,
      tags: point.payload.tags || [],
    }));

  return combined;
};


/**
 * 🚀 God Plan: Context Hydrator Helper
 * Fetches a specific chunk (usually a Parent Section) by its ID.
 */
export const getChunkById = async (id: string) => {
  try {
    const result = await client.retrieve(COLLECTION_NAME, {
      ids: [id],
      with_payload: true,
      with_vector: false
    });

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error(`❌ Failed to hydrate chunk ${id}:`, error);
    return null;
  }
};


export { client };