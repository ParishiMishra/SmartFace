import { db, collection, getDocs } from './firebase-config.js';

let tfliteModel;
let tfModel; // TensorFlow.js model (model.json)

// This function tries to load a TFJS `model.json` first, then falls back to TFLite.
export const loadTFLiteModel = async () => {
    if (tfliteModel || tfModel) return { tfModel, tfliteModel };
    console.log('Loading ML model (TFJS model.json preferred, fallback to TFLite)...');

    // Try TFJS model.json first (common case when you have model.json)
    if (typeof tf !== 'undefined' && (tf.loadGraphModel || tf.loadLayersModel)) {
        const tfCandidates = ['/models/model.json', './models/model.json', '../models/model.json', '../../models/model.json'];
        for (const url of tfCandidates) {
            try {
                console.log('Attempting to load TFJS model from', url);
                // Prefer loadGraphModel if available
                if (tf.loadGraphModel) {
                    tfModel = await tf.loadGraphModel(url);
                } else {
                    tfModel = await tf.loadLayersModel(url);
                }
                console.log('TFJS model loaded successfully from', url);
                return { tfModel, tfliteModel };
            } catch (err) {
                console.warn('TFJS model load failed for', url, err);
            }
        }
    } else {
        console.warn('tf (TensorFlow.js) runtime not found; skipping TFJS model.json load attempts.');
    }

    // If TFJS model didn't load, try TFLite runtime.
    if (typeof tflite === 'undefined' || !tflite.loadTFLiteModel) {
        console.warn('tf-tflite runtime not found or model.json not available; TFLite load skipped.');
    } else {
        const candidates = ['/models/facenet.tflite', './models/facenet.tflite', '../models/facenet.tflite', '../../models/facenet.tflite'];
        let lastErr = null;
        for (const modelUrl of candidates) {
            try {
                console.log('Attempting to load TFLite model from', modelUrl);
                tfliteModel = await tflite.loadTFLiteModel(modelUrl);
                console.log('TFLite Model loaded successfully from', modelUrl);
                return { tfModel, tfliteModel };
            } catch (err) {
                console.warn('TFLite load failed for', modelUrl, err);
                lastErr = err;
            }
        }
        if (lastErr) console.error('TFLite load attempts failed:', lastErr);
    }

    // If we reach here, no model loaded. Throw a helpful error so callers know.
    const msg = 'Unable to load any model. Ensure either a TFJS `model.json` exists under /models/model.json or a TFLite file exists under /models/facenet.tflite, and that scripts for the corresponding runtimes are included in index.html.';
    console.error(msg);
    throw new Error(msg);
};

// This function gets the embedding from an image
export const getFaceEmbedding = async (imageElement) => {
    // Ensure a model is loaded (either TFJS or TFLite)
    if (!tfModel && !tfliteModel) {
        await loadTFLiteModel();
    }

    // Preprocess the image into a tensor the model expects
    // NOTE: this project expects Xception-like preprocessing for a 256x256 RGB input:
    //   - resize to [256,256]
    //   - scale pixels to [-1, 1] using (x / 127.5) - 1
    // If your exported model expects a different preprocessing (e.g., [0,1] range),
    // change `preprocessing` to '0to1'.
    const preprocessing = 'xception'; // 'xception' or '0to1'

    const imgTensor = tf.browser.fromPixels(imageElement)
        .resizeNearestNeighbor([256, 256])
        .toFloat();

    let normalized;
    if (preprocessing === 'xception') {
        // Xception/Keras preprocessing: scale to [-1, 1]
        normalized = imgTensor.div(tf.scalar(127.5)).sub(tf.scalar(1.0));
    } else {
        // Simple 0..1 normalization
        normalized = imgTensor.div(tf.scalar(255));
    }
    const input = normalized.expandDims(0); // shape [1, H, W, 3]

    let embeddingTensor;
    if (tfModel) {
        // TFJS model: predict directly
        embeddingTensor = tfModel.predict(input);
    } else if (tfliteModel) {
        // TFLite runtime: same interface used previously
        embeddingTensor = tfliteModel.predict(input);
    } else {
        throw new Error('No model loaded to compute embedding.');
    }

    const embeddingData = await embeddingTensor.data();
    tf.dispose([imgTensor, normalized, input, embeddingTensor]);
    return Array.from(embeddingData);
};

// This function finds the closest match to the embedding
export const findMatch = async (newEmbedding, schoolId, classId) => {
    let minDistance = Infinity;
    let bestStudent = null;
    const threshold = 0.6; // Threshold for matching — tune this for your model

    const studentsCollectionRef = collection(db, `schools/${schoolId}/classes/${classId}/students`);
    const snapshot = await getDocs(studentsCollectionRef);
    const studentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    for (const student of studentsData) {
        if (!student.embeddings || student.embeddings.length === 0) continue;

        // Compare against all stored embeddings for the student
        for (const storedEmbedding of student.embeddings) {
            if (!storedEmbedding || storedEmbedding.length !== newEmbedding.length) continue;

            const distance = Math.sqrt(
                newEmbedding.reduce((sum, val, i) => sum + Math.pow(val - storedEmbedding[i], 2), 0)
            );

            if (distance < minDistance) {
                minDistance = distance;
                bestStudent = { id: student.id, name: student.name || null, rollNumber: student.rollNumber || null };
            }
        }
    }

    if (minDistance < threshold) {
        return { student: bestStudent, distance: minDistance };
    }
    return { student: null, distance: minDistance };
};