
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
 
 
 
 // export const initStorage = async () => {
 //   const collections = await client.getCollections();
 //   const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
 
 //   if (!exists) {
 //     // 1. Create collection with vectors + sparse support
 //     await client.createCollection(COLLECTION_NAME, {
 //       vectors: {
 //         "text-dense": {
 //           size: 768,
 //           distance: 'Cosine'
 //         }
 //       },
 //       sparse_vectors: {
 //         "text-sparse": {
 //           index: { full_scan_threshold: 1000 }
 //         }
 //       }
 //     });
 
 //     console.log(`✅ Collection '${COLLECTION_NAME}' created.`);
 
 //     // 2. Explicitly create payload indexes (this is the reliable way)
 //     const fieldsToIndex = [
 //       { key: "filePath", type: "keyword" },
 //       { key: "timestamp", type: "datetime" },
 //       { key: "tags", type: "keyword" },
 //       { key: "chunkLevel", type: "integer" },
 //       { key: "headingPath", type: "keyword" }
 //     ];
 
 //     for (const field of fieldsToIndex) {
 //       await client.createPayloadIndex(COLLECTION_NAME, {
 //         field_name: field.key,
 //         field_schema: field.type as any
 //       });
 //     }
 
 //     console.log(`✅ All payload indexes created for fast filtering.`);
 //   }
 // };

 export const initStorage = async (forceRecreate = false) => {
   const collections = await client.getCollections();
   const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
 
   if (exists && forceRecreate) {
     await client.deleteCollection(COLLECTION_NAME);
     console.log(`🗑️ Deleted existing collection '${COLLECTION_NAME}'.`);
   }
 
   if (!exists || forceRecreate) {
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

 // 
 import { computeSparseVector } from './services/sparseVector.js';
 
 
 export const upsertChunk = async (
   id: string,
   denseVector: number[],
   text: string,
   payload: any
 ) => {
   await saveChunkText(id, text);
   
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
         // text,
       },
     }],
   });
 };

/**
 * Delete ALL chunks for a specific file (used on CHANGE & unlink)
 */

//  for text store in another db
// 
export const deleteNoteByFilePath = async (filePath: string) => {
  // 1. Fetch all point IDs for this filePath
  const scroll = await client.scroll(COLLECTION_NAME, {
    filter: { must: [{ key: 'filePath', match: { value: filePath } }] },
    with_payload: false,
    with_vector: false,
    limit: 100, // we may need to paginate
  });

  const ids = scroll.points.map(p => p.id as string);
  
  // 2. Delete the text files
  await deleteChunkTexts(ids);
  
  // 3. Delete the points from Qdrant
  await client.delete(COLLECTION_NAME, {
    filter: { must: [{ key: 'filePath', match: { value: filePath } }] },
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


import { rerank } from "./services/reranker.js";
import { deleteChunkTexts, getChunkText, saveChunkText } from './services/chunkStorage.js';



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

  const combined = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(async ({ point }) => {
      let text = '';
      const rawId = point.id;
      const cleanId = rawId.replace(/-/g, ''); // remove hyphens
      try {
        text = await getChunkText(cleanId);
      } catch (err) {
        const payloadText = point.payload.text;
        if (payloadText && typeof payloadText === 'string') {
          text = payloadText;
          console.log(`📎 Fallback: using payload text for ${rawId}`);
          await saveChunkText(cleanId, text);
        } else {
          console.warn(`⚠️ No text found for chunk ${rawId} (file missing, payload missing)`);
        }
      }
      return {
        id: point.id,
        score: point.score,
        text,
        headingPath: point.payload.headingPath || [],
        filePath: point.payload.filePath,
        parentId: point.payload.parentId || null,
        chunkLevel: point.payload.chunkLevel,
        tags: point.payload.tags || [],
        sectionId: point.payload.sectionId,
        isSection: point.payload.isSection,     // ← add
      };
    });
  const resolved = await Promise.all(combined);
  console.log(`🔍 Retrieved ${resolved.length} points with IDs:`, resolved.map(c => c.id).join(', '));
  return resolved.map(r => ({
    ...r,
    sectionId: r.sectionId, // ensure it's passed through
    isSection: r.isSection,
  }));

}


export const getChunkById = async (id: string) => {
  try {
    const result = await client.retrieve(COLLECTION_NAME, {
      ids: [id],
      with_payload: true,
      with_vector: false
    });
    if (result.length === 0) return null;
    const point = result[0];
    const cleanId = id.replace(/-/g, '');
    let text = '';

    try {
      text = await getChunkText(cleanId);
    } catch (fileError) {
      const payloadText = (point.payload as any)?.text;
      if (payloadText && typeof payloadText === 'string') {
        text = payloadText;
        console.log(`📎 Fallback: using payload text for ${id}`);
        await saveChunkText(cleanId, text);
      } else {
        throw fileError;
      }
    }

    return {
      id: point.id,
      payload: {
        ...point.payload,
        text,
      },
    };
  } catch (error) {
    console.error(`❌ Failed to hydrate chunk ${id}:`, error);
    return null;
  }
};
export { client, COLLECTION_NAME };



