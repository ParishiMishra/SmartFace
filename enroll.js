import { auth, db, onAuthStateChanged, signInWithPopup, googleProvider, doc, setDoc } from './firebase-config.js';
import { loadTFLiteModel, getFaceEmbedding } from './face-recognition.js';

const video = document.getElementById('enroll-video');
const captureBtn = document.getElementById('capture-sample');
const samplesDiv = document.getElementById('samples');
const enrollBtn = document.getElementById('enroll-btn');
const status = document.getElementById('status');

let samples = [];

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    status.textContent = 'Unable to access camera: ' + err.message;
  }
}

captureBtn.addEventListener('click', () => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.style.maxWidth = '120px';
  img.style.border = '1px solid #ccc';
  samplesDiv.appendChild(img);
  samples.push(canvas);
});

enrollBtn.addEventListener('click', async () => {
  const schoolId = document.getElementById('school-id').value.trim();
  const classId = document.getElementById('class-id').value.trim();
  const name = document.getElementById('student-name').value.trim();
  const roll = document.getElementById('roll-number').value.trim();

  if (!schoolId || !classId || !name || !roll) {
    status.textContent = 'Please fill all fields.';
    return;
  }

  if (samples.length === 0) {
    status.textContent = 'Please capture at least one sample photo.';
    return;
  }

  status.textContent = 'Loading model and computing embeddings...';
  try {
    await loadTFLiteModel();
  } catch (err) {
    // loadTFLiteModel throws if no model was loaded; but getFaceEmbedding
    // also will attempt to load. We still proceed so user can enroll without model
    console.warn('Model load error (enroll):', err);
    status.textContent = 'Model not loaded; enrollment will store raw images only.';
  }

  const embeddings = [];
  for (const canvas of samples) {
    try {
      const emb = await getFaceEmbedding(canvas);
      embeddings.push(emb);
    } catch (err) {
      console.warn('Embedding error for sample, skipping:', err);
    }
  }

  // Save to Firestore
  try {
    const docRef = doc(db, `schools/${schoolId}/classes/${classId}/students/${name.replace(/\s+/g, '_').toLowerCase()}`);
    // If embeddings computed, save them; otherwise save photo data URLs for offline processing
    const payload = { name, rollNumber: roll };
    if (embeddings.length > 0) payload.embeddings = embeddings;
    else payload.sampleImages = samples.map(c => c.toDataURL('image/png'));

    await setDoc(docRef, payload, { merge: true });
    status.textContent = 'Enrolled ' + name + ' successfully.';
    // reset
    samples = [];
    samplesDiv.innerHTML = '';
  } catch (err) {
    console.error(err);
    status.textContent = 'Failed to save student: ' + err.message;
  }
});

startCamera();

// Ensure user is signed in before allowing enrollment writes (optional but recommended)
onAuthStateChanged(auth, (user) => {
  if (!user) {
    signInWithPopup(auth, googleProvider).catch(err => console.warn('Sign-in cancelled', err));
  }
});
