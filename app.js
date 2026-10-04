/* EchoVue PWA prototype 0.2 — local-only folder reader + WMV transcode in browser */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const els = {
    installBtn: $('#installBtn'), openFolderBtn: $('#openFolderBtn'), folderInput: $('#folderInput'),
    searchInput: $('#searchInput'), libraryStatus: $('#libraryStatus'), examTableBody: $('#examTableBody'),
    libraryView: $('#libraryView'), examView: $('#examView'), backBtn: $('#backBtn'), examTitle: $('#examTitle'), examMeta: $('#examMeta'),
    thumbGrid: $('#thumbGrid'), sourceVideo: $('#sourceVideo'), canvas: $('#videoCanvas'), viewerPlaceholder: $('#viewerPlaceholder'),
    transcodeStatus: $('#transcodeStatus'), timeline: $('#timeline'), timeLabel: $('#timeLabel'), speedSelect: $('#speedSelect'),
    prevCineBtn: $('#prevCineBtn'), nextCineBtn: $('#nextCineBtn'), stepBackBtn: $('#stepBackBtn'), stepForwardBtn: $('#stepForwardBtn'),
    playBtn: $('#playBtn'), stopBtn: $('#stopBtn'), screenshotBtn: $('#screenshotBtn'), fullscreenBtn: $('#fullscreenBtn'), viewerStage: $('#viewerStage'),
    brightness: $('#brightness'), contrast: $('#contrast'), gamma: $('#gamma'), sharpness: $('#sharpness'),
    brightnessOut: $('#brightnessOut'), contrastOut: $('#contrastOut'), gammaOut: $('#gammaOut'), sharpnessOut: $('#sharpnessOut'),
    errorDialog: $('#errorDialog'), errorText: $('#errorText')
  };

  const state = {
    exams: [], filtered: [], currentExam: null, currentCineIndex: -1,
    deferredInstall: null, ffmpeg: null, ffmpegLoaded: false, transcoding: false,
    blobUrl: null, gl: null, renderer: null,
    settings: {brightness:0, contrast:1, gamma:1, sharpness:0},
    cache: new Map(),
  };

  function showError(message) {
    console.error(message);
    els.errorText.textContent = String(message || 'Kesalahan tidak diketahui.');
    if (typeof els.errorDialog.showModal === 'function') els.errorDialog.showModal();
    else alert(message);
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function parseIni(text) {
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith(';') || line.startsWith('#') || (line.startsWith('[') && line.endsWith(']'))) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      out[line.slice(0,i).trim()] = line.slice(i+1).trim();
    }
    return out;
  }

  function joinName(meta) {
    const parts = [meta.PatLastName, meta.PatFirstName].filter(Boolean);
    if (parts.length) return parts.join(', ');
    return meta.PatientName || meta.PatName || 'Tanpa nama';
  }

  function pathOf(file) { return file.webkitRelativePath || file._relativePath || file.name; }
  function dirOf(path) { const i = path.lastIndexOf('/'); return i >= 0 ? path.slice(0,i) : ''; }
  function baseOf(path) { const i = path.lastIndexOf('/'); return i >= 0 ? path.slice(i+1) : path; }

  async function scanFiles(files) {
    const arr = Array.from(files);
    const byDir = new Map();
    for (const f of arr) {
      const d = dirOf(pathOf(f));
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(f);
    }
    const exams = [];
    for (const [dir, list] of byDir.entries()) {
      const ini = list.find(f => /^Exam\.ini$/i.test(baseOf(pathOf(f))));
      if (!ini) continue;
      let meta = {};
      try { meta = parseIni(await ini.text()); } catch (e) { console.warn('Gagal membaca Exam.ini', dir, e); }
      const cines = [];
      const thumbs = new Map();
      for (const f of list) {
        const name = baseOf(pathOf(f));
        let m = name.match(/^m(\d+)\.(wmv|mp4|m4v|mov)$/i);
        if (m) cines.push({index:Number(m[1]), file:f, name, format:m[2].toLowerCase()});
        m = name.match(/^m(\d+)(?:_small)?\.(jpg|jpeg|png)$/i);
        if (m) {
          const idx = Number(m[1]);
          const isSmall = /_small/i.test(name);
          if (!thumbs.has(idx) || isSmall) thumbs.set(idx, f);
        }
      }
      cines.sort((a,b) => a.index - b.index);
      cines.forEach(c => { c.thumb = thumbs.get(c.index) || null; });
      exams.push({
        dir, meta, ini,
        id: meta.PatID || meta.PatientID || '', otherId: meta.OtherID || meta.OtherId || '',
        name: joinName(meta), examDate: meta.ExamDate || '', birthDate: meta.BirthDate || '', sex: meta.Sex || '',
        numImages: Number(meta.NumImages || cines.length) || cines.length,
        cines
      });
    }
    exams.sort((a,b) => `${b.examDate}`.localeCompare(`${a.examDate}`));
    return exams;
  }

  async function scanDirectoryHandle(dirHandle, prefix='') {
    const files = [];
    async function walk(handle, path) {
      for await (const [name, child] of handle.entries()) {
        const rel = path ? `${path}/${name}` : name;
        if (child.kind === 'file') {
          const f = await child.getFile();
          Object.defineProperty(f, '_relativePath', {value: rel, enumerable:false});
          files.push(f);
        } else if (child.kind === 'directory') {
          await walk(child, rel);
        }
      }
    }
    await walk(dirHandle, prefix);
    return files;
  }

  function renderLibrary() {
    const q = els.searchInput.value.trim().toLowerCase();
    state.filtered = !q ? state.exams : state.exams.filter(e => [e.id,e.otherId,e.name,e.examDate,e.birthDate].join(' ').toLowerCase().includes(q));
    els.examTableBody.innerHTML = '';
    if (!state.filtered.length) {
      els.examTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">Tidak ada pemeriksaan yang cocok.</td></tr>';
      return;
    }
    for (const e of state.filtered) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(e.id)}</td><td>${esc(e.otherId)}</td><td>${esc(e.name)}</td><td>${esc(e.examDate)}</td><td>${esc(e.birthDate)}</td><td class="num">${e.numImages || e.cines.length}</td>`;
      tr.addEventListener('click', () => openExam(e));
      els.examTableBody.appendChild(tr);
    }
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function chooseFolder() {
    try {
      if ('showDirectoryPicker' in window) {
        const h = await window.showDirectoryPicker({mode:'read'});
        els.libraryStatus.textContent = 'Membaca folder…';
        const files = await scanDirectoryHandle(h);
        await loadFiles(files);
      } else {
        els.folderInput.click();
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      showError(`Gagal membuka folder: ${e.message || e}`);
    }
  }

  async function loadFiles(files) {
    els.libraryStatus.textContent = `Memindai ${files.length} file…`;
    const exams = await scanFiles(files);
    state.exams = exams;
    els.searchInput.disabled = exams.length === 0;
    els.libraryStatus.textContent = exams.length ? `${exams.length} pemeriksaan ditemukan. Klik baris untuk membuka.` : 'Tidak ditemukan Exam.ini pada folder yang dipilih.';
    renderLibrary();
  }

  async function openExam(exam) {
    state.currentExam = exam;
    state.currentCineIndex = -1;
    stopVideo();
    els.libraryView.hidden = true;
    els.examView.hidden = false;
    els.examTitle.textContent = exam.name || 'Exam View';
    const bits = [exam.id && `ID ${exam.id}`, exam.examDate && `Exam ${exam.examDate}`, exam.birthDate && `DOB ${exam.birthDate}`, `${exam.cines.length} cine`].filter(Boolean);
    els.examMeta.textContent = bits.join(' • ');
    renderThumbs(exam);
    if (exam.cines.length) await selectCine(0);
  }

  function renderThumbs(exam) {
    els.thumbGrid.innerHTML = '';
    exam.cines.forEach((c, pos) => {
      const card = document.createElement('div');
      card.className = 'thumb';
      card.dataset.pos = pos;
      const tag = document.createElement('span'); tag.className = 'numtag'; tag.textContent = String(pos+1); card.appendChild(tag);
      if (c.thumb) {
        const img = document.createElement('img'); img.alt = `Cine ${pos+1}`; img.src = URL.createObjectURL(c.thumb); card.appendChild(img);
      } else {
        const fb = document.createElement('div'); fb.className = 'fallback'; fb.textContent = `Cine ${pos+1}\n${c.name}`; card.appendChild(fb);
      }
      card.addEventListener('click', () => selectCine(pos));
      els.thumbGrid.appendChild(card);
    });
  }

  function markActiveThumb() {
    [...els.thumbGrid.children].forEach((n,i) => n.classList.toggle('active', i === state.currentCineIndex));
  }

  async function selectCine(pos) {
    const exam = state.currentExam;
    if (!exam || pos < 0 || pos >= exam.cines.length || state.transcoding) return;
    state.currentCineIndex = pos;
    markActiveThumb();
    const cine = exam.cines[pos];
    await loadCine(cine);
  }

  function cleanupBlob() {
    if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
  }

  async function ensureFFmpeg() {
    if (state.ffmpegLoaded) return state.ffmpeg;
    if (!window.FFmpegWASM || !window.FFmpegUtil) throw new Error('Library FFmpeg WebAssembly tidak dapat dimuat. Pastikan Mac terhubung ke internet saat pertama kali membuka aplikasi.');
    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL } = window.FFmpegUtil;
    const ff = new FFmpeg();
    ff.on('log', ({message}) => { if (message) console.debug('[ffmpeg]', message); });
    ff.on('progress', ({progress}) => {
      if (state.transcoding) els.transcodeStatus.textContent = `Menyiapkan WMV lokal… ${Math.round((progress || 0)*100)}%`;
    });
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
    await ff.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
    });
    state.ffmpeg = ff; state.ffmpegLoaded = true;
    return ff;
  }

  async function transcodeWMV(file) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (state.cache.has(key)) return state.cache.get(key);
    const ff = await ensureFFmpeg();
    const { fetchFile } = window.FFmpegUtil;
    const id = Math.random().toString(36).slice(2);
    const input = `in-${id}.wmv`, output = `out-${id}.mp4`;
    await ff.writeFile(input, await fetchFile(file));
    let ok = false;
    try {
      await ff.exec(['-i', input, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
      ok = true;
    } catch (e) {
      console.warn('libx264 gagal, mencoba MPEG-4', e);
      await ff.exec(['-i', input, '-an', '-c:v', 'mpeg4', '-q:v', '2', output]);
      ok = true;
    }
    if (!ok) throw new Error('Konversi WMV gagal.');
    const data = await ff.readFile(output);
    try { await ff.deleteFile(input); await ff.deleteFile(output); } catch {}
    const blob = new Blob([data.buffer], {type:'video/mp4'});
    state.cache.set(key, blob);
    return blob;
  }

  async function loadCine(cine) {
    stopVideo(); cleanupBlob();
    els.viewerPlaceholder.hidden = false;
    const spin = els.viewerPlaceholder.querySelector('.spinner'); spin.hidden = false;
    els.viewerPlaceholder.querySelector('p').textContent = 'Menyiapkan cine…';
    els.transcodeStatus.hidden = false;
    state.transcoding = true;
    try {
      let blob;
      if (cine.format === 'wmv') {
        els.transcodeStatus.textContent = 'Menyiapkan WMV lokal…';
        blob = await transcodeWMV(cine.file);
      } else {
        blob = cine.file;
      }
      state.blobUrl = URL.createObjectURL(blob);
      els.sourceVideo.src = state.blobUrl;
      await new Promise((resolve,reject) => {
        const ok = () => { cleanup(); resolve(); };
        const bad = () => { cleanup(); reject(new Error('Video tidak dapat dibaca setelah konversi.')); };
        const cleanup = () => { els.sourceVideo.removeEventListener('loadedmetadata',ok); els.sourceVideo.removeEventListener('error',bad); };
        els.sourceVideo.addEventListener('loadedmetadata',ok,{once:true}); els.sourceVideo.addEventListener('error',bad,{once:true});
        els.sourceVideo.load();
      });
      els.timeline.disabled = false; els.speedSelect.disabled = false;
      els.sourceVideo.loop = true; els.sourceVideo.playbackRate = Number(els.speedSelect.value);
      initRenderer(); resizeCanvas(); renderFrame();
      els.viewerPlaceholder.hidden = true;
      await els.sourceVideo.play().catch(() => {});
      updatePlayButton();
    } catch (e) {
      showError(e.message || e);
      els.viewerPlaceholder.querySelector('p').textContent = 'Gagal membuka cine.';
      spin.hidden = true;
    } finally {
      state.transcoding = false; els.transcodeStatus.hidden = true;
    }
  }

  function initRenderer() {
    if (state.renderer) return;
    const gl = els.canvas.getContext('webgl', {preserveDrawingBuffer:true, premultipliedAlpha:false});
    if (!gl) throw new Error('WebGL tidak tersedia pada browser ini. Gunakan Chrome terbaru di MacBook.');
    const vs = `attribute vec2 aPos; attribute vec2 aTex; varying vec2 vTex; void main(){ gl_Position=vec4(aPos,0.,1.); vTex=aTex; }`;
    const fs = `precision mediump float; varying vec2 vTex; uniform sampler2D uTex; uniform vec2 uPx; uniform float uBrightness; uniform float uContrast; uniform float uGamma; uniform float uSharp;
      void main(){
        vec3 c=texture2D(uTex,vTex).rgb;
        if(uSharp>0.001){
          vec3 n=texture2D(uTex,vTex+vec2(0.,-uPx.y)).rgb;
          vec3 s=texture2D(uTex,vTex+vec2(0., uPx.y)).rgb;
          vec3 e=texture2D(uTex,vTex+vec2( uPx.x,0.)).rgb;
          vec3 w=texture2D(uTex,vTex+vec2(-uPx.x,0.)).rgb;
          c = c*(1.0+4.0*uSharp) - (n+s+e+w)*uSharp;
        }
        c=(c-0.5)*uContrast+0.5;
        c=c+uBrightness;
        c=pow(max(c,vec3(0.0)), vec3(1.0/max(uGamma,0.01)));
        gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);
      }`;
    function shader(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    const p=gl.createProgram(); gl.attachShader(p,shader(gl.VERTEX_SHADER,vs)); gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); gl.useProgram(p);
    const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, -1,1,0,0, 1,-1,1,1, 1,1,1,0]),gl.STATIC_DRAW);
    const aPos=gl.getAttribLocation(p,'aPos'), aTex=gl.getAttribLocation(p,'aTex');
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(aTex); gl.vertexAttribPointer(aTex,2,gl.FLOAT,false,16,8);
    const tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    state.gl=gl; state.renderer={p,tex,uPx:gl.getUniformLocation(p,'uPx'),uBrightness:gl.getUniformLocation(p,'uBrightness'),uContrast:gl.getUniformLocation(p,'uContrast'),uGamma:gl.getUniformLocation(p,'uGamma'),uSharp:gl.getUniformLocation(p,'uSharp')};
  }

  function resizeCanvas() {
    const v=els.sourceVideo; if(!v.videoWidth || !v.videoHeight) return;
    if (els.canvas.width !== v.videoWidth || els.canvas.height !== v.videoHeight) { els.canvas.width=v.videoWidth; els.canvas.height=v.videoHeight; }
    if(state.gl) state.gl.viewport(0,0,els.canvas.width,els.canvas.height);
  }

  function renderFrame() {
    const v=els.sourceVideo, gl=state.gl, r=state.renderer;
    if(!gl || !r || v.readyState < 2) return;
    resizeCanvas(); gl.bindTexture(gl.TEXTURE_2D,r.tex);
    try { gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,v); } catch { return; }
    gl.uniform2f(r.uPx,1/els.canvas.width,1/els.canvas.height);
    gl.uniform1f(r.uBrightness,state.settings.brightness); gl.uniform1f(r.uContrast,state.settings.contrast); gl.uniform1f(r.uGamma,state.settings.gamma); gl.uniform1f(r.uSharp,state.settings.sharpness);
    gl.drawArrays(gl.TRIANGLES,0,6);
  }

  function renderLoop() {
    renderFrame();
    updateTimeline();
    requestAnimationFrame(renderLoop);
  }

  function updateTimeline() {
    const v=els.sourceVideo; if(!Number.isFinite(v.duration) || !v.duration) return;
    if(!els.timeline.matches(':active')) els.timeline.value = Math.round((v.currentTime / v.duration)*1000);
    els.timeLabel.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
  }

  function updatePlayButton(){ els.playBtn.textContent = els.sourceVideo.paused ? '▶' : '❚❚'; }
  function stopVideo(){ const v=els.sourceVideo; try{v.pause(); v.currentTime=0;}catch{} updatePlayButton(); }
  function step(sec){ const v=els.sourceVideo; if(!Number.isFinite(v.duration)) return; v.pause(); v.currentTime=Math.min(v.duration,Math.max(0,v.currentTime+sec)); renderFrame(); updatePlayButton(); }

  function applyPreset(name) {
    const presets = {
      original:{brightness:0,contrast:1,gamma:1,sharpness:0},
      gelike:{brightness:0.01,contrast:1.13,gamma:0.92,sharpness:0.12}
    };
    if (presets[name]) Object.assign(state.settings,presets[name]);
    document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.preset===name));
    syncSliders(); renderFrame();
  }
  function syncSliders(){
    for (const k of ['brightness','contrast','gamma','sharpness']) { els[k].value=state.settings[k]; els[`${k}Out`].textContent=Number(state.settings[k]).toFixed(2); }
  }
  function onSlider(k){ state.settings[k]=Number(els[k].value); els[`${k}Out`].textContent=state.settings[k].toFixed(2); document.querySelectorAll('.preset').forEach(b=>b.classList.toggle('active',b.dataset.preset==='custom')); renderFrame(); }

  function screenshot() {
    if(!els.canvas.width) return;
    els.canvas.toBlob(blob => {
      if(!blob) return;
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); const e=state.currentExam; a.download=`EchoVue_${(e?.id||'exam')}_cine${state.currentCineIndex+1}_${Math.round(els.sourceVideo.currentTime*1000)}ms.png`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    },'image/png');
  }

  function bindEvents() {
    els.openFolderBtn.addEventListener('click', chooseFolder);
    els.folderInput.addEventListener('change', e => loadFiles(e.target.files));
    els.searchInput.addEventListener('input', renderLibrary);
    els.backBtn.addEventListener('click', () => { stopVideo(); els.examView.hidden=true; els.libraryView.hidden=false; });
    els.prevCineBtn.addEventListener('click', () => selectCine(Math.max(0,state.currentCineIndex-1)));
    els.nextCineBtn.addEventListener('click', () => selectCine(Math.min((state.currentExam?.cines.length||1)-1,state.currentCineIndex+1)));
    els.playBtn.addEventListener('click', async () => { const v=els.sourceVideo; if(!v.src) return; if(v.paused) await v.play().catch(()=>{}); else v.pause(); updatePlayButton(); });
    els.stopBtn.addEventListener('click', stopVideo);
    els.stepBackBtn.addEventListener('click', () => step(-1/30));
    els.stepForwardBtn.addEventListener('click', () => step(1/30));
    els.timeline.addEventListener('input', () => { const v=els.sourceVideo; if(Number.isFinite(v.duration)) v.currentTime=(Number(els.timeline.value)/1000)*v.duration; });
    els.speedSelect.addEventListener('change', () => { els.sourceVideo.playbackRate=Number(els.speedSelect.value); });
    els.sourceVideo.addEventListener('play',updatePlayButton); els.sourceVideo.addEventListener('pause',updatePlayButton); els.sourceVideo.addEventListener('seeked',renderFrame);
    els.screenshotBtn.addEventListener('click', screenshot);
    els.fullscreenBtn.addEventListener('click', () => els.viewerStage.requestFullscreen?.());
    document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
    for (const k of ['brightness','contrast','gamma','sharpness']) els[k].addEventListener('input',() => onSlider(k));
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.deferredInstall=e; els.installBtn.hidden=false; });
    els.installBtn.addEventListener('click', async () => { if(!state.deferredInstall) return; state.deferredInstall.prompt(); await state.deferredInstall.userChoice; state.deferredInstall=null; els.installBtn.hidden=true; });
  }

  bindEvents(); applyPreset('original'); renderLoop();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
})();
