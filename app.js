import { auth, db, onAuthStateChanged, googleProvider, signInWithPopup, signOut, doc, setDoc, collection, getDocs } from './firebase-config.js';
import { loadTFLiteModel, getFaceEmbedding, findMatch } from './face-recognition.js';

const appContainer = document.getElementById('app-container');
const state = {
    currentUser: null,
    currentSchoolId: null,
    currentClassId: null,
    schools: [
        { id: 'school1', name: 'Gramin Pathshala' },
        { id: 'school2', name: 'Krishi Vidya Niketan' },
        { id: 'school3', name: 'Prakash Gram Vidhyalaya' },
        { id: 'school4', name: 'Gyan Jyoti Public School' }
    ],
    classes: Array.from({ length: 12 }, (_, i) => ({ id: `class${i+1}`, name: `Class ${i+1}` }))
};

// --- View Rendering Functions ---

// Helper: sign out and navigate back to login page
const logoutAndNavigateToLogin = async () => {
    try {
        await signOut(auth);
    } catch (err) {
        console.warn('Sign out failed:', err);
    }
    // Clear state and navigate to default (login)
    state.currentUser = null;
    location.hash = '#/';
    handleRouting();
};

const renderHeader = (title) => {
    return `
        <header class="app-header">
            <h1 class="header-title">${title}</h1>
            <nav style="display:flex;gap:8px;align-items:center;">
                ${state.currentUser ? `<a id="enroll-link" href="#/enroll" class="btn" style="padding:8px 10px;font-size:0.9rem;">Enroll a New Student</a>` : ''}
                ${state.currentUser ? `<button id="download-attendance-csv-btn" class="btn" style="padding:8px 10px;font-size:0.9rem;">Download CSV</button>` : ''}
                ${state.currentUser ? `<button id="logout-btn" class="btn logout-btn">Logout</button>` : ''}
            </nav>
        </header>
    `;
};

const renderAuthPage = () => {
    appContainer.innerHTML = `
        ${renderHeader('Teacher Login')}
        <div class="page-container auth-page-container">
            <div class="card auth-card">
                <img src="icons/school-logo.svg" alt="School Logo" class="school-logo">
                <h2>Hello, Teacher!</h2>
                <p>Please sign in to mark attendance.</p>
                <button id="google-signin-btn" class="btn google-btn">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/1200px-Google_%22G%22_logo.svg.png" alt="Google logo" class="google-logo-icon"> Sign in with Google
                </button>
            </div>
        </div>
    `;
    document.getElementById('google-signin-btn').addEventListener('click', () => {
        signInWithPopup(auth, googleProvider).catch(error => alert(error.message));
    });
};

const renderSchoolClassSelection = () => {
    const schoolOptions = state.schools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    const classOptions = state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
    appContainer.innerHTML = `
        ${renderHeader('Select School & Class')}
        <div class="page-container school-class-container">
            <div class="card">
                <h2>Select Your School & Class</h2>
                <div class="select-group">
                    <label for="school-select">School</label>
                    <select id="school-select">
                        <option value="">-- Select --</option>
                        ${schoolOptions}
                    </select>
                </div>
                <div class="select-group">
                    <label for="class-select">Class</label>
                    <select id="class-select" disabled>
                        <option value="">-- Select --</option>
                        ${classOptions}
                    </select>
                </div>
                <button id="launch-camera-btn" class="btn" disabled>Launch Camera</button>
            </div>
        </div>
    `;

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logoutAndNavigateToLogin);

    const schoolSelect = document.getElementById('school-select');
    const classSelect = document.getElementById('class-select');
    const launchBtn = document.getElementById('launch-camera-btn');

    schoolSelect.addEventListener('change', (e) => {
        state.currentSchoolId = e.target.value;
        classSelect.disabled = !state.currentSchoolId;
        launchBtn.disabled = true;
    });

    classSelect.addEventListener('change', (e) => {
        state.currentClassId = e.target.value;
        launchBtn.disabled = !state.currentClassId;
    });

    launchBtn.addEventListener('click', renderAttendancePage);
};

// --- Enrollment page (integrated into SPA) ---
const renderEnrollPage = () => {
    appContainer.innerHTML = `
        ${renderHeader('Enroll a New Student')}
        <div class="page-container">
            <div class="card">
                <h2>Enroll Student</h2>
                <div class="form-row">
                    <label>School ID</label>
                    <input id="enroll-school" placeholder="school1" />
                </div>
                <div class="form-row">
                    <label>Class ID</label>
                    <input id="enroll-class" placeholder="class1" />
                </div>
                <div class="form-row">
                    <label>Student Name</label>
                    <input id="enroll-name" placeholder="Full name" />
                </div>
                <div class="form-row">
                    <label>Roll Number</label>
                    <input id="enroll-roll" placeholder="23" />
                </div>
                <h3>Capture Samples</h3>
                <div class="video-wrapper"><video id="enroll-video" autoplay playsinline muted></video></div>
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <button id="capture-sample" class="btn">Capture Sample</button>
                    <button id="enroll-submit" class="btn">Enroll Student</button>
                </div>
                <div id="sample-list" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"></div>
                <div id="enroll-status" style="margin-top:12px;color:#333"></div>
            </div>
        </div>
    `;

    // Wire logout button (header may be re-rendered) if present
    const logoutBtnEl = document.getElementById('logout-btn');
    if (logoutBtnEl) logoutBtnEl.addEventListener('click', logoutAndNavigateToLogin);

    // Start camera
    const video = document.getElementById('enroll-video');
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            video.srcObject = stream;
            await video.play();
        } catch (err) {
            document.getElementById('enroll-status').textContent = 'Unable to access camera: ' + err.message;
        }
    };
    startCamera();

    let samples = [];
    document.getElementById('capture-sample').addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.className = 'preview-image';
        document.getElementById('sample-list').appendChild(img);
        samples.push(canvas);
    });

    document.getElementById('enroll-submit').addEventListener('click', async () => {
        const schoolId = document.getElementById('enroll-school').value.trim();
        const classId = document.getElementById('enroll-class').value.trim();
        const name = document.getElementById('enroll-name').value.trim();
        const roll = document.getElementById('enroll-roll').value.trim();
        const statusEl = document.getElementById('enroll-status');

        if (!schoolId || !classId || !name || !roll) { statusEl.textContent = 'Please fill all fields.'; return; }
        if (samples.length === 0) { statusEl.textContent = 'Please capture at least one sample.'; return; }

        statusEl.textContent = 'Computing embeddings...';
        try {
            await loadTFLiteModel();
        } catch (err) {
            console.warn('Model load (enroll) error:', err);
            statusEl.textContent = 'Model not loaded; enrollment will save sample images.';
        }

        const embeddings = [];
        for (const c of samples) {
            try { const emb = await getFaceEmbedding(c); embeddings.push(emb); } catch (e) { console.warn('embed failed', e); }
        }

        try {
            const slug = name.replace(/\s+/g,'_').toLowerCase();
            const docRef = doc(db, `schools/${schoolId}/classes/${classId}/students/${slug}`);
            const payload = { name, rollNumber: roll };
            if (embeddings.length) payload.embeddings = embeddings;
            else payload.sampleImages = samples.map(c => c.toDataURL('image/png'));
            await setDoc(docRef, payload, { merge: true });
            statusEl.textContent = `Enrolled ${name}`;
            samples = []; document.getElementById('sample-list').innerHTML = '';
        } catch (err) { console.error(err); statusEl.textContent = 'Save failed: '+err.message; }
    });
};

// Simple hash router
function handleRouting() {
    const hash = location.hash || '#/';
    if (hash.startsWith('#/enroll')) return renderEnrollPage();
    // default route
    if (state.currentUser) renderSchoolClassSelection(); else renderAuthPage();
}
window.addEventListener('hashchange', handleRouting);

const renderAttendancePage = async () => {
    appContainer.innerHTML = `
        ${renderHeader('Mark Attendance')}
        <div class="page-container attendance-page-container">
            <div class="card">
                <h2>Mark Attendance</h2>
                <div class="video-wrapper">
                    <video id="webcam-video" autoplay playsinline muted></video>
                </div>
                <div class="status-box">
                    <p id="status-text">Loading camera...</p>
                </div>
                <div class="button-group">
                    <button id="capture-face-btn" class="btn scan-btn" disabled>
                        <span class="icon">📸</span>
                        Capture Face
                    </button>
                    <button id="manual-fallback-btn" class="btn fallback-btn">
                        <span class="icon">📝</span>
                        Manual / QR
                    </button>
                </div>
            </div>
        </div>
    `;

    const logoutBtn2 = document.getElementById('logout-btn');
    if (logoutBtn2) logoutBtn2.addEventListener('click', logoutAndNavigateToLogin);

    const video = document.getElementById('webcam-video');
    const statusText = document.getElementById('status-text');
    const captureFaceBtn = document.getElementById('capture-face-btn');
    const manualBtn = document.getElementById('manual-fallback-btn');

  
    let modelReady = false;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;

     
        await new Promise((resolve) => {
            const onLoaded = () => {
                video.play().then(resolve).catch((err) => {
                    console.warn('video.play() rejected:', err);
                    resolve();
                });
            };
            video.addEventListener('loadedmetadata', onLoaded, { once: true });
            setTimeout(() => resolve(), 2000);
        });

        statusText.textContent = 'Camera started. Loading model...';
        manualBtn.disabled = false;

    
        captureFaceBtn.disabled = false;
        loadTFLiteModel().then(() => {
            modelReady = true;
            statusText.textContent = 'Ready to scan. Please look at the camera.';
        }).catch((err) => {
            console.error('Model load failed:', err);
            statusText.textContent = 'Model failed to load. Capture will still work (preview only).';
        });
    } catch (error) {
        statusText.textContent = 'Camera error. Please check permissions and secure context (localhost/HTTPS).';
        console.error("Error launching camera:", error);
        captureFaceBtn.disabled = true;
        manualBtn.disabled = true;
        return;
    }

    captureFaceBtn.addEventListener('click', async () => {
        captureFaceBtn.disabled = true;
        statusText.textContent = 'Capturing face...';

        const canvas = document.createElement('canvas');
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 480;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            if (modelReady) {
                const embedding = await getFaceEmbedding(canvas);
                if (embedding && embedding.length > 0) {
                    const { student, distance } = await findMatch(embedding, state.currentSchoolId, state.currentClassId);
                    if (student) {
                        statusText.textContent = `Match: ${student.name || student.id} (Roll ${student.rollNumber || 'N/A'}) — distance ${distance.toFixed(3)}. Marking attendance...`;
                        await markAttendance(student.id, 'Face Recognition', student.name, student.rollNumber);
                    } else {
                        statusText.textContent = `No match found (closest distance ${distance.toFixed(3)}). Try again.`;
                    }
                } else {
                    statusText.textContent = 'No face detected in the image.';
                }
            } else {
                // Model not available: show captured preview and provide a download link
                const dataUrl = canvas.toDataURL('image/png');
                showPreviewAndDownload(dataUrl);
                statusText.textContent = 'Model not available. Captured image shown for manual processing.';
            }
        } catch (error) {
            console.error("Processing error:", error);
            statusText.textContent = 'An error occurred during face processing.';
        } finally {
            captureFaceBtn.disabled = false;
        }
    });

    // Helper to show a small preview and a download link for the captured image
    function showPreviewAndDownload(dataUrl) {
        // remove any existing preview
        const existing = document.getElementById('capture-preview');
        if (existing) existing.remove();

        const wrapper = document.createElement('div');
        wrapper.id = 'capture-preview';
        wrapper.style.marginTop = '12px';
        wrapper.innerHTML = `
            <h3>Captured Image</h3>
            <img src="${dataUrl}" alt="Captured" style="max-width:100%;height:auto;border:1px solid #ccc;" />
            <div style="margin-top:8px">
                <a id="download-capture" href="${dataUrl}" download="capture.png" class="btn">Download Image</a>
            </div>
        `;

        const card = appContainer.querySelector('.card');
        if (card) card.appendChild(wrapper);
    }

    manualBtn.addEventListener('click', () => {
        openQRScanner();
    });
};

// --- QR scanner modal and logic ---
function openQRScanner() {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'qr-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = 0;
    overlay.style.top = 0;
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = 9999;

    overlay.innerHTML = `
        <div style="background:#fff;padding:16px;border-radius:12px;max-width:720px;width:90%;text-align:center;">
            <h3>Scan QR to mark attendance</h3>
            <div style="position:relative;padding-top:56.25%;border-radius:8px;overflow:hidden;margin-bottom:12px;">
                <video id="qr-video" autoplay playsinline style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;border-radius:8px;"></video>
                <canvas id="qr-canvas" style="display:none"></canvas>
            </div>
            <div>
                <button id="close-qr" class="btn">Close</button>
            </div>
            <p id="qr-status" style="margin-top:8px;color:#666"></p>
        </div>
    `;

    document.body.appendChild(overlay);

    const qrVideo = document.getElementById('qr-video');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrStatus = document.getElementById('qr-status');

    let scanning = true;
    let rafId;

    async function startScanner() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            qrVideo.srcObject = stream;
            await qrVideo.play();

            const canvas = qrCanvas;
            const ctx = canvas.getContext('2d');

            const scanLoop = () => {
                if (!scanning) return;
                if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
                    canvas.width = qrVideo.videoWidth;
                    canvas.height = qrVideo.videoHeight;
                    ctx.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(imageData.data, imageData.width, imageData.height);
                    if (code) {
                        // Found QR code
                        qrStatus.textContent = 'QR detected! Processing...';
                        scanning = false;
                        handleQRPayload(code.data).catch(err => {
                            console.error('QR handling error', err);
                            qrStatus.textContent = 'Failed to process QR payload.';
                            scanning = false;
                        });
                        return;
                    } else {
                        qrStatus.textContent = 'Scanning for QR...';
                    }
                }
                rafId = requestAnimationFrame(scanLoop);
            };

            scanLoop();
        } catch (err) {
            qrStatus.textContent = 'Camera error: ' + err.message;
        }
    }

    startScanner();

    function stopScanner() {
        scanning = false;
        const stream = qrVideo.srcObject;
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
        }
        if (rafId) cancelAnimationFrame(rafId);
        overlay.remove();
    }

    document.getElementById('close-qr').addEventListener('click', stopScanner);
}

async function handleQRPayload(data) {
  
    let payload = null;
    try {
        payload = JSON.parse(data);
    } catch (e) {
       
        payload = { studentId: data };
    }

    // Close overlay
    const overlay = document.getElementById('qr-overlay');
    if (overlay) overlay.remove();

    // If we have studentId, mark attendance directly
    if (payload.studentId) {
        await markAttendance(payload.studentId, 'QR Code');
        alert('Attendance marked for student id: ' + payload.studentId);
        return;
    }

    // If we have rollNumber, try to look up student in current selected school/class
    if (payload.rollNumber && state.currentSchoolId && state.currentClassId) {
        // Query Firestore for student with that rollNumber
        const studentsCollectionRef = collection(db, `schools/${state.currentSchoolId}/classes/${state.currentClassId}/students`);
        const snapshot = await getDocs(studentsCollectionRef);
        const found = snapshot.docs.find(d => (d.data().rollNumber || '').toString() === payload.rollNumber.toString());
        if (found) {
            await markAttendance(found.id, 'QR Code');
            alert('Attendance marked for ' + (found.data().name || found.id));
            return;
        } else {
            alert('No student found with roll number: ' + payload.rollNumber);
            return;
        }
    }

    alert('QR payload not recognized. Expected studentId or rollNumber JSON.');
}

const markAttendance = async (studentId, method, studentName = null, rollNumber = null) => {
    const today = new Date().toISOString().slice(0, 10);
    const attendanceDocRef = doc(db, `schools/${state.currentSchoolId}/classes/${state.currentClassId}/attendance/${today}`);
    const entry = {
        isPresent: true,
        method,
        timestamp: new Date().toISOString()
    };
    if (studentName) entry.name = studentName;
    if (rollNumber) entry.rollNumber = rollNumber;

    await setDoc(attendanceDocRef, {
        [studentId]: entry
    }, { merge: true });
    console.log(`Attendance marked for student ${studentId}.`);
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        state.currentUser = user;
        handleRouting();
    } else {
        state.currentUser = null;
        handleRouting();
    }
});

// initial route
handleRouting();

// Wire Download CSV button (prototype): builds a small sample CSV and triggers download
function wireCsvButton() {
    const btn = document.getElementById('download-attendance-csv-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        generatePrototypeCSV();
    });
}


window.addEventListener('hashchange', () => setTimeout(wireCsvButton, 50));
setTimeout(wireCsvButton, 100);

function generatePrototypeCSV() {
    const today = new Date().toISOString().slice(0,10);
    const school = state.currentSchoolId || 'school-placeholder';
    const cls = state.currentClassId || 'class-placeholder';

    const header = ['schoolId','classId','date','studentId','name','rollNumber','isPresent','method','timestamp'];
    const sampleRows = [
        [school, cls, today, 'student_001', 'Ram Kumar', '1', 'true', 'Face Recognition', new Date().toISOString()],
        [school, cls, today, 'student_002', 'Sita Devi', '2', 'false', 'Manual', new Date().toISOString()]
    ];

    const csvLines = [header.join(',')].concat(sampleRows.map(r => r.map(String).map(s => '"'+s.replace(/"/g,'""')+'"').join(',')));
    const csvContent = csvLines.join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-report-${school}-${cls}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

}
