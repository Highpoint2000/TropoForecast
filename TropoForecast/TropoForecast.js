    /////////////////////////////////////////////////////////////////////
    ///                                                               ///
    ///  TROPO FORECAST (CLIENT MODUL) FOR FM-DX-WEBSERVER      V2.0c ///
    ///                                                               ///
    ///  by Highpoint                        last update: 2026-08-31  ///
    ///                                                               ///
	///  Revised by AmateurAudioDude                                  ///
    ///                                                               ///
    ///  https://github.com/Highpoint2000/TropoForecast               ///
    ///                                                               ///
    /////////////////////////////////////////////////////////////////////

(() => {


    // ------------- Configuration ----------------
    const pluginSetupOnlyNotify = false;
    const CHECK_FOR_UPDATES = false;

    // Plugin metadata
    const pluginVersion = '2.0b';
    const CACHE_VERSION = pluginVersion;
    const pluginName = "TropoForecast";
    const pluginHomepageUrl = "https://github.com/Highpoint2000/TropoForecast/releases";
    const pluginUpdateUrl = "https://raw.githubusercontent.com/Highpoint2000/TropoForecast/main/TropoForecast/TropoForecast.js";
    let isAuth = false;

    // WebSocket endpoint
    const url = new URL(window.location.href);
    const host = url.hostname;
    const path = url.pathname.replace(/setup/g, '');
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const WS_URL = `${proto}//${host}:${port}${path}data_plugins`;
    let ws = null;

    // WS request/response infrastructure for server proxy calls
    let wsReqCounter = 0;
    const pendingWsRequests = new Map();
    const WS_REQUEST_TIMEOUT_MS = 35000;

    function wsRequest(type, payload) {
        return new Promise((resolve, reject) => {
            function doSend() {
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    reject(new Error('WebSocket not open'));
                    return;
                }
                const requestId = `tropo_${++wsReqCounter}_${Date.now()}`;
                const timeoutId = setTimeout(() => {
                    if (pendingWsRequests.has(requestId)) {
                        pendingWsRequests.delete(requestId);
                        reject(new Error('WS request timeout'));
                    }
                }, WS_REQUEST_TIMEOUT_MS);
                pendingWsRequests.set(requestId, { resolve, reject, timeoutId });
                try {
                    ws.send(JSON.stringify({ type, requestId, ...payload }));
                } catch (e) {
                    clearTimeout(timeoutId);
                    pendingWsRequests.delete(requestId);
                    reject(e);
                }
            }

            if (ws && ws.readyState === WebSocket.CONNECTING) {
                // Socket is mid-handshake, wait up to 4s for it to open
                const connectTimeout = setTimeout(() => reject(new Error('WS connect timeout')), 4000);
                ws.addEventListener('open',  () => { clearTimeout(connectTimeout); doSend(); }, { once: true });
                ws.addEventListener('close', () => { clearTimeout(connectTimeout); reject(new Error('WebSocket closed during connect')); }, { once: true });
            } else {
                doSend();
            }
        });
    }

    // GPS data storage
    let gpsData = {
        lat: null,
        lon: null,
        alt: null,
        status: 'inactive'
    };

    // Fallback for sendToast
    if (typeof sendToast !== "function") {
        window.sendToast = function (cls, src, txt) {
            console.log(`[TOAST-Fallback] ${src}: ${cls} → ${txt}`);
        };
    }

    // ------------- Update Check ----------------
    function checkUpdate(setupOnly, pluginName, urlUpdateLink, urlFetchLink) {
        if (setupOnly && window.location.pathname !== '/setup') return;

        let pluginVersionCheck = typeof pluginVersion !== 'undefined' ? pluginVersion
            : typeof plugin_version !== 'undefined' ? plugin_version
            : typeof PLUGIN_VERSION !== 'undefined' ? PLUGIN_VERSION : 'Unknown';

        async function fetchFirstLine() {
            const urlCheckForUpdate = urlFetchLink + '?t=' + new Date().getTime();
            try {
                const response = await fetch(urlCheckForUpdate, { cache: 'no-store' });
                if (!response.ok) throw new Error(`[${pluginName}] update check error`);
                const text = await response.text();
                const lines = text.split('\n');
                let version;
                if (lines.length > 2) {
                    const versionLine = lines.find(line =>
                        line.includes("const pluginVersion =") ||
                        line.includes("const plugin_version =") ||
                        line.includes("const PLUGIN_VERSION =")
                    );
                    if (versionLine) {
                        const match = versionLine.match(/const\s+(?:pluginVersion|plugin_version|PLUGIN_VERSION)\s*=\s*['"]([^'"]+)['"]/);
                        if (match) version = match[1];
                    }
                }
                if (!version) {
                    const firstLine = lines[0].trim();
                    version = /^\d/.test(firstLine) ? firstLine : "Unknown";
                }
                return version;
            } catch (error) { return null; }
        }

        fetchFirstLine().then(newVersion => {
            if (newVersion && newVersion !== pluginVersionCheck) {
                setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink);
            }
        });

        function setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink) {
            if (window.location.pathname === '/setup') {
                const pluginSettings = document.getElementById('plugin-settings');
                if (pluginSettings) {
                    const currentText = pluginSettings.textContent.trim();
                    const newText = `<br><a href="${urlUpdateLink}" target="_blank">[${pluginName}] Update available: ${pluginVersionCheck} --> ${newVersion}</a><br>`;
                    pluginSettings.innerHTML = currentText === 'No plugin settings are available.'
                        ? newText
                        : pluginSettings.innerHTML + ' ' + newText;
                }
                const updateIcon = document.querySelector('.wrapper-outer #navigation .sidenav-content .fa-puzzle-piece')
                    || document.querySelector('.sidenav-content');
                if (updateIcon) {
                    const redDot = document.createElement('span');
                    redDot.style.cssText = 'display:block; width:12px; height:12px; border-radius:50%; background-color:#FE0830; margin-left:82px; margin-top:-12px;';
                    updateIcon.appendChild(redDot);
                }
            }
        }
    }

    if (CHECK_FOR_UPDATES) checkUpdate(pluginSetupOnlyNotify, pluginName, pluginHomepageUrl, pluginUpdateUrl);

    // ------------- WebSocket Setup ----------------
    async function setupWebSocket() {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
            try {
                ws = new WebSocket(WS_URL);
                ws.addEventListener('open', () => { console.log('[TropoForecast] WebSocket connected'); updateCurrentTropoIndicator(); });
                ws.addEventListener('message', handleMessage);
                ws.addEventListener('error', e => console.error('[TropoForecast] WebSocket error'));
                ws.addEventListener('close', () => setTimeout(setupWebSocket, 5000));
            } catch (err) { setTimeout(setupWebSocket, 5000); }
        }
    }

    function handleMessage(evt) {
        try {
            const msg = JSON.parse(evt.data);

            // Handle server proxy responses
            if (msg.type === 'Plugin-Tropo-Grid-Response' || msg.type === 'Plugin-Tropo-Point-Response') {
                // Grid responses fan out one shared payload to every requestId that was
                // waiting on it (requestIds[]), point responses still use a single requestId.
                const ids = msg.requestIds || (msg.requestId ? [msg.requestId] : []);
                ids.forEach(id => {
                    const entry = pendingWsRequests.get(id);
                    if (entry) {
                        clearTimeout(entry.timeoutId);
                        pendingWsRequests.delete(id);
                        if (msg.ok) entry.resolve(msg);
                        else entry.reject(new Error(msg.error || 'request failed'));
                    }
                });
                return;
            }

            if (msg.type === 'GPS' && msg.value) {
                const { status, lat, lon, alt } = msg.value;
                if (status === 'active' && lat && lon) {
                    const prevLat = gpsData.lat;
                    const prevLon = gpsData.lon;

                    gpsData.lat    = lat;
                    gpsData.lon    = lon;
                    gpsData.alt    = alt || null;
                    gpsData.status = 'active';

                    updateHeaderCoordinates();

                    if (container && container.style.display !== 'none') {
                        if (!mapInstance || !positionMarker) {
                            if (mapInstance) drawPositionMarker(lat, lon);
                        } else {
                            updateMapMarker();
                        }
                    }

                    if (prevLat === null || Math.abs(prevLat - lat) > 0.05 || Math.abs(prevLon - lon) > 0.05) {
                        updateCurrentTropoIndicator();
                        isPrefetching = false;
                        startBackgroundWorker();
                    }
                } else {
                    if (gpsData.status === 'active') {
                        gpsData.status = 'inactive';
                        updateHeaderCoordinates();
                    }
                }
            }
        } catch (e) { }
    }

    // ------------- Core Configuration -------------------
    const CONFIG = {
        renderRes:       1024,
        masterRadius:    650,
        defaultRadius:   500,
        blurAmount:      'blur(1.2px)',
        opacity:         0.80,
        cacheValidityMs: 3600000 // 1 hour client-side cache
    };

    const PALETTE = [
        {color: 'rgba(0,0,0,0)',           label: ''},
        {color: 'rgba(150,50,220,0.7)',    label: 'Trace'},       // Minimal signal fading
        {color: 'rgba(200,50,160,0.8)',    label: 'Weak'},        // Weak signals
        {color: 'rgba(240,60,100,0.8)',    label: 'Elevated'},    // Slightly elevated conditions
        {color: 'rgba(255,90,40,0.9)',     label: 'Enhanced'},    // Clearly enhanced signals
        {color: 'rgba(255,140,10,0.9)',    label: 'Strong'},      // Strong signals, RDS possible
        {color: 'rgba(255,190,0,1.0)',     label: 'Very Strong'}, // Very strong signals, stable RDS
        {color: 'rgba(255,230,50,1.0)',    label: 'Band Open'},   // Band opens for long distance DX
        {color: 'rgba(255,245,130,1.0)',   label: 'Extreme DX'},  // Exceptional ranges
        {color: 'rgba(255,250,200,1.0)',   label: 'Ducting'},     // Tropo ducting
        {color: 'rgba(255,255,255,1.0)',   label: 'Solid Duct'}   // Maximum ducting, extreme conditions
    ];

    let TropoMapActive       = false;
    let container            = null;
    let mapInstance          = null;
    let weatherOverlayCanvas = null;
    let frames               = [];
    let currentFrameIndex    = 0;
    let isPlaying            = false;
    let animationFrameId     = null;
    let positionMarker       = null;

    let apiBounds            = null;
    let lastSelectedRadius   = localStorage.getItem('lastSelectedRadius') || CONFIG.defaultRadius;
    let hourUpdateInterval   = null;
    let headerUpdateInterval = null;
    let lastHourChecked      = -1;

    let isFetchingData       = false;

    let lastIndicatorFetchTime = 0;
    let lastIndicatorLat     = null;
    let lastIndicatorLon     = null;
    let locationName         = null;
    let forecastHours        = null;
    let masterFetchStatus    = 'pending';
    let isPrefetching        = false;

    function getGridSize() {
        return 12;
    }

    function getLastFullHour() { return new Date().getUTCHours(); }

    function checkHourChange() {
        if (!TropoMapActive || !container || container.style.display === 'none') return;
        const currentHour = getLastFullHour();
        if (currentHour !== lastHourChecked && !isFetchingData) {
            console.log(`[TropoForecast] Hour changed to ${currentHour}. Reloading...`);
            lastHourChecked = currentHour;
            loadDataForRadius(parseInt(lastSelectedRadius));
        }
    }

    function calculateBounds(lat, lon, radiusKm) {
        const latDeg = radiusKm / 111.0;
        const lonDeg = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));
        return {
            minLat: lat - latDeg, maxLat: lat + latDeg,
            minLon: lon - lonDeg, maxLon: lon + lonDeg
        };
    }

    function updateAllButtons(state) {
        masterFetchStatus = state;

        const masterBtn = document.getElementById('btn-500');
        if (masterBtn) {
            if (state === 'pending' || state === 'loading') {
                masterBtn.disabled  = true;
                masterBtn.innerHTML = `500km <span class="spin" style="font-size:10px">⟳</span>`;
                masterBtn.title     = "Downloading 500km data...";
            } else if (state === 'ready') {
                masterBtn.disabled  = false;
                masterBtn.innerHTML = `500km`;
                masterBtn.title     = `Display 500km forecast (${forecastHours ? forecastHours + 'h' : '...'})` ;
            } else if (state === 'error') {
                masterBtn.disabled  = true;
                masterBtn.innerHTML = `500km \u26A0\uFE0F`;
                masterBtn.title     = "API Hourly/Daily Limit Reached.";
            } else if (state === 'retrying') {
                masterBtn.disabled  = true;
                masterBtn.innerHTML = `500km ⏳`;
                masterBtn.title     = "Retrying API request...";
            }
        }

        const subReady = (state === 'ready');
        [100, 200, 300, 400].forEach(r => {
            const btn = document.getElementById(`btn-${r}`);
            if (!btn) return;
            btn.disabled  = !subReady;
            btn.innerHTML = `${r}km`;
            btn.title = subReady
                ? `Zoom to ${r}km (using 500km master data)`
                : (state === 'error' ? "API Limit Reached." : "Waiting for 500km master data...");
        });
    }

    function loadLeaflet(callback) {
        if (window.L) { callback(); return; }
        const css    = document.createElement('link');
        css.rel      = 'stylesheet';
        css.href     = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
        const script = document.createElement('script');
        script.src   = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = callback;
        document.head.appendChild(script);
    }

    // --- INDICATOR BUTTON LOGIC ---
    async function updateCurrentTropoIndicator() {
        let lat, lon;
        const qLat = localStorage.getItem('qthLatitude');
        const qLon = localStorage.getItem('qthLongitude');

        if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
            lat = parseFloat(gpsData.lat);
            lon = parseFloat(gpsData.lon);
        } else if (qLat && qLon) {
            lat = parseFloat(qLat);
            lon = parseFloat(qLon);
        } else {
            return;
        }

        // Fast path: use already-rendered frame data (force CURRENT time, ignore slider)
        if (apiBounds && frames.length > 0) {
            const nowUtcHour = new Date();
            nowUtcHour.setUTCMinutes(0, 0, 0);
            // Suche den Frame, der der aktuellen UTC-Stunde entspricht
            const currentFrame = frames.find(f => f.time.getTime() === nowUtcHour.getTime()) || frames[0];
            
            const val  = interpolateGridValue(lat, lon, currentFrame.visValues, apiBounds, getGridSize());
            const idx  = val > 0.5 ? Math.round(val) : 0;
            const cIdx = Math.max(0, Math.min(idx, 10));
            applyIndicatorColor(PALETTE[cIdx].color, PALETTE[cIdx].label, idx);
            return;
        }

        // Cache path: look up the 500km master cache (stores precomputed index grid)
        const cacheKey      = `tropo_v${CACHE_VERSION}_${Math.round(lat * 100)}_${Math.round(lon * 100)}_500`;
        const cachedDataStr = localStorage.getItem(cacheKey);

        if (cachedDataStr) {
            try {
                const cached = JSON.parse(cachedDataStr);
                if (Date.now() - cached.timestamp < CONFIG.cacheValidityMs && cached.grid && cached.grid.length > 0) {
                    const bounds    = calculateBounds(lat, lon, 500);
                    const timeArray = cached.time;
                    const nowIso    = new Date().toISOString().slice(0, 13) + ':00';
                    let idx         = timeArray.findIndex(t => t === nowIso);
                    if (idx < 0) idx = 0;

                    const visValues = new Float32Array(cached.grid[idx]);
                    const val  = interpolateGridValue(lat, lon, visValues, bounds, getGridSize());
                    const cIdx2 = val > 0.5 ? Math.round(val) : 0;
                    const cIdx = Math.max(0, Math.min(cIdx2, 10));
                    applyIndicatorColor(PALETTE[cIdx].color, PALETTE[cIdx].label, cIdx2);
                    return;
                }
            } catch (e) { }
        }

        // Fallback: single-point WS request (max once per 15 min per location)
        const now        = Date.now();
        const locChanged = lastIndicatorLat === null
            || Math.abs(lastIndicatorLat - lat) > 0.05
            || Math.abs(lastIndicatorLon - lon) > 0.05;
        if (!locChanged && (now - lastIndicatorFetchTime < 15 * 60 * 1000)) return;

        lastIndicatorFetchTime = now;
        lastIndicatorLat       = lat;
        lastIndicatorLon       = lon;

        try {
            const resp = await wsRequest('Plugin-Tropo-Point-Request', { lat, lon });
            if (typeof resp.index === 'number') {
                const indexVal = resp.index;
                const idx      = indexVal > 0.5 ? Math.round(indexVal) : 0;
                const cIdx     = Math.max(0, Math.min(idx, 10));
                applyIndicatorColor(PALETTE[cIdx].color, PALETTE[cIdx].label, idx);
            }
        } catch (e) { }
    }

    function applyIndicatorColor(color, label, indexVal) {
        const btn = document.getElementById('TROPO-BTN');
        if (!btn) return;
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';

        let indicator = document.getElementById('tropo-btn-indicator');
        if (!indicator) {
            indicator             = document.createElement('div');
            indicator.id          = 'tropo-btn-indicator';
            indicator.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:5px;background-color:transparent;pointer-events:none;transition:background-color 0.5s ease;z-index:10;';
            btn.appendChild(indicator);
        }

        if (color === 'rgba(0,0,0,0)' || !color) {
            indicator.style.backgroundColor = 'transparent';
            indicator.title = 'Current Tropo: None / Normal Conditions';
        } else {
            indicator.style.backgroundColor = color;
            indicator.title = `Current Tropo: ${label} (+${indexVal})`;
        }

        const walk = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT, null, false);
        let n;
        while (n = walk.nextNode()) {
            if (n.nodeValue.includes('Tropo')) {
                n.nodeValue = indexVal > 0 ? `Tropo +${indexVal}` : 'Tropo';
                break;
            }
        }
    }

    // --- RENDERING ---
    function interpolateGridValue(lat, lon, apiValues, bounds, gridRes) {
        const u  = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * (gridRes - 1);
        const v  = (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat) * (gridRes - 1);
        const x0 = Math.floor(u);
        const x1 = Math.min(x0 + 1, gridRes - 1);
        const y0 = Math.floor(v);
        const y1 = Math.min(y0 + 1, gridRes - 1);

        if (x0 < 0 || x1 >= gridRes || y0 < 0 || y1 >= gridRes) return 0;

        const wx  = u - x0;
        const wy  = v - y0;
        const v00 = apiValues[y0 * gridRes + x0] || 0;
        const v10 = apiValues[y0 * gridRes + x1] || 0;
        const v01 = apiValues[y1 * gridRes + x0] || 0;
        const v11 = apiValues[y1 * gridRes + x1] || 0;

        return (v00 * (1 - wx) + v10 * wx) * (1 - wy) +
               (v01 * (1 - wx) + v11 * wx) * wy;
    }

    function renderDataToImage(apiValues, bounds) {
        const gridRes   = getGridSize();
        const canvas    = document.createElement('canvas');
        canvas.width    = CONFIG.renderRes;
        canvas.height   = CONFIG.renderRes;
        const ctx       = canvas.getContext('2d');
        const imageData = ctx.createImageData(CONFIG.renderRes, CONFIG.renderRes);
        const data      = imageData.data;

        for (let py = 0; py < CONFIG.renderRes; py++) {
            for (let px = 0; px < CONFIG.renderRes; px++) {
                const lat = bounds.maxLat - (py / CONFIG.renderRes) * (bounds.maxLat - bounds.minLat);
                const lon = bounds.minLon + (px / CONFIG.renderRes) * (bounds.maxLon - bounds.minLon);
                const val = interpolateGridValue(lat, lon, apiValues, bounds, gridRes);

                if (val > 0.5) {
                    const colorIdx = Math.round(val);
                    const colorObj = PALETTE[Math.min(colorIdx, 10)];
                    const i        = (py * CONFIG.renderRes + px) * 4;
                    const match    = colorObj.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]*)\)/);
                    if (match) {
                        data[i]     = parseInt(match[1]);
                        data[i + 1] = parseInt(match[2]);
                        data[i + 2] = parseInt(match[3]);
                        data[i + 3] = match[4] ? Math.round(parseFloat(match[4]) * 255) : 255;
                    }
                }
            }
        }
        ctx.putImageData(imageData, 0, 0);

        const final  = document.createElement('canvas');
        final.width  = CONFIG.renderRes;
        final.height = CONFIG.renderRes;
        const fCtx   = final.getContext('2d');
        fCtx.filter  = CONFIG.blurAmount;
        fCtx.drawImage(canvas, 0, 0);
        return final;
    }

    function renderFrame(index) {
        if (!frames[index] || !mapInstance) return;
        if (index < 0) index = 0;
        if (index >= frames.length) index = frames.length - 1;

        currentFrameIndex = index;

        const t          = frames[index].time;
        const dateEl     = document.getElementById('tropo-date');
        const clockEl    = document.getElementById('tropo-clock');
        const offsetEl   = document.getElementById('tropo-offset');
        const timelineEl = document.getElementById('tropo-timeline');

        if (dateEl) dateEl.innerText = t.toUTCString().split(' ').slice(0, 4).join(' ');
        if (clockEl) {
            const hh = String(t.getUTCHours()).padStart(2, '0');
            const mm = String(t.getUTCMinutes()).padStart(2, '0');
            clockEl.innerHTML = `<span title="UTC Time">${hh}:${mm} UTC</span>`;
        }
        if (offsetEl) {
            offsetEl.innerText   = `(+${index}h)`;
            offsetEl.style.color = 'var(--color-4)';
        }
        if (timelineEl) timelineEl.value = index;

        if (!frames[index].renderedImage) {
            frames[index].renderedImage = renderDataToImage(frames[index].visValues, apiBounds);
        }
        drawOnMap(frames[index].renderedImage);
    }

    function drawOnMap(imageCanvas) {
        if (!weatherOverlayCanvas || !mapInstance || !apiBounds) return;
        const ctx  = weatherOverlayCanvas.getContext('2d');
        const size = mapInstance.getSize();

        if (weatherOverlayCanvas.width !== size.x || weatherOverlayCanvas.height !== size.y) {
            weatherOverlayCanvas.width  = size.x;
            weatherOverlayCanvas.height = size.y;
        }
        ctx.clearRect(0, 0, size.x, size.y);

        const nw   = L.latLng(apiBounds.maxLat, apiBounds.minLon);
        const se   = L.latLng(apiBounds.minLat, apiBounds.maxLon);
        const nwPx = mapInstance.latLngToContainerPoint(nw);
        const sePx = mapInstance.latLngToContainerPoint(se);

        ctx.globalAlpha = CONFIG.opacity;
        ctx.drawImage(imageCanvas, nwPx.x, nwPx.y, sePx.x - nwPx.x, sePx.y - nwPx.y);
        ctx.globalAlpha = 1.0;
    }

    function animationLoop() {
        if (!isPlaying || frames.length <= 1) {
            animationFrameId = null;
            isPlaying = false;
            updatePlayButton();
            return;
        }
        currentFrameIndex = (currentFrameIndex + 1) % frames.length;
        renderFrame(currentFrameIndex);
        animationFrameId = setTimeout(animationLoop, 1000);
    }

    function togglePlay() {
        if (frames.length <= 1) return;
        isPlaying = !isPlaying;
        updatePlayButton();
        if (isPlaying && !animationFrameId) animationLoop();
        else if (!isPlaying && animationFrameId) { clearTimeout(animationFrameId); animationFrameId = null; }
    }

    function updatePlayButton() {
        const btn = document.getElementById('tropo-play-btn');
        if (!btn) return;
        if (frames.length <= 1) {
            btn.style.opacity = '0.4';
            btn.style.cursor  = 'not-allowed';
            btn.innerHTML     = '▶';
        } else {
            btn.style.opacity = '1';
            btn.style.cursor  = 'pointer';
            if (isPlaying) {
                btn.innerHTML = '❚❚';
                btn.title     = 'Pause';
                btn.classList.add('color-4');
            } else {
                btn.innerHTML = '▶';
                btn.title     = 'Play';
                btn.classList.remove('color-4');
            }
        }
    }

    function updateHeaderCoordinates() {
        const badgeEl = document.getElementById('tropo-validation-badge');
        if (!badgeEl) return;
        
        const qthLat = localStorage.getItem('qthLatitude');
        const qthLon = localStorage.getItem('qthLongitude');
        
        // 1. Highest priority: GPS coordinates
        if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
            badgeEl.textContent = `${parseFloat(gpsData.lat).toFixed(5)}° / ${parseFloat(gpsData.lon).toFixed(5)}° (GPS)`;
            
        // 2. Second priority: QTH coordinates
        } else if (qthLat && qthLon) {
            badgeEl.textContent = `${parseFloat(qthLat).toFixed(5)}° / ${parseFloat(qthLon).toFixed(5)}° (QTH)`;
            
        // 3. Third priority: Location name (only if coordinates are missing)
        } else if (locationName) {
            badgeEl.textContent = `${locationName} (QTH)`;
            
        // 4. If absolutely nothing is available
        } else {
            badgeEl.textContent = 'No Position';
        }
    }

    function updateMapMarker() {
        if (mapInstance && positionMarker && gpsData.lat && gpsData.lon) {
            const lat = parseFloat(gpsData.lat);
            const lon = parseFloat(gpsData.lon);
            if (!isNaN(lat) && !isNaN(lon)) positionMarker.setLatLng([lat, lon]);
        }
    }

    function drawPositionMarker(lat, lon) {
        if (positionMarker) mapInstance.removeLayer(positionMarker);
        const lt = parseFloat(lat);
        const ln = parseFloat(lon);
        positionMarker = L.circleMarker([lt, ln], {
            radius: 5, fillColor: '#FF0000', color: '#FF0000', weight: 0, opacity: 1, fillOpacity: 0.9
        }).addTo(mapInstance);
        positionMarker.bindPopup(`📍 Position<br>${lt.toFixed(5)}° / ${ln.toFixed(5)}°`);
    }

    // --- API FETCHING (via server proxy) ---
    async function fetchAndCacheTropoData(centerLat, centerLon) {
        const radiusKm = CONFIG.masterRadius;
        const bounds   = calculateBounds(centerLat, centerLon, radiusKm);
        const cacheKey = `tropo_v${CACHE_VERSION}_${Math.round(centerLat * 100)}_${Math.round(centerLon * 100)}_500`;

        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
            try {
                const cached = JSON.parse(cachedRaw);
                if (Date.now() - cached.timestamp < CONFIG.cacheValidityMs && cached.grid && cached.grid.length > 0) {
                    if (cached.locationName) locationName = cached.locationName;
                    if (cached.forecastHours) forecastHours = cached.forecastHours;
                    return { time: cached.time, grid: cached.grid, bounds, fromCache: true };
                }
            } catch (e) { }
        }

        const resp = await wsRequest('Plugin-Tropo-Grid-Request', { lat: centerLat, lon: centerLon, radius: radiusKm });
        const grid = Array.isArray(resp.grid) ? resp.grid : [];
        if (!grid.length) throw new Error('Empty grid response from server');
        if (resp.locationName) locationName = resp.locationName;
        if (resp.forecastHours) forecastHours = resp.forecastHours;

        const cachePayload = JSON.stringify({ time: resp.time, grid, locationName, forecastHours, timestamp: Date.now() });
        try {
            localStorage.setItem(cacheKey, cachePayload);
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                Object.keys(localStorage)
                    .filter(k => k.startsWith('tropo_'))
                    .forEach(k => localStorage.removeItem(k));
                try { localStorage.setItem(cacheKey, cachePayload); } catch (err) { }
            }
        }

        return { time: resp.time, grid, bounds, fromCache: false };
    }

    async function fetchWithRetry(lat, lon) {
        let attempt     = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
            updateAllButtons(attempt === 0 ? 'loading' : 'retrying');

            try {
                await fetchAndCacheTropoData(lat, lon);
                updateAllButtons('ready');
                return true;
            } catch (e) {
                attempt++;
                console.error(`[TropoForecast] Fetch failed (attempt ${attempt}/${maxAttempts}):`, e);
                if (attempt < maxAttempts) {
                    await new Promise(res => setTimeout(res, 20000));
                } else {
                    updateAllButtons('error');
                    return false;
                }
            }
        }
        return false;
    }

    // --- BACKGROUND WORKER ---
    async function startBackgroundWorker() {
        if (isPrefetching) return;
        isPrefetching = true;

        while (true) {
            if (isFetchingData) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            let lat, lon;
            const qLat = localStorage.getItem('qthLatitude');
            const qLon = localStorage.getItem('qthLongitude');

            if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
                lat = parseFloat(gpsData.lat);
                lon = parseFloat(gpsData.lon);
            } else if (qLat && qLon) {
                lat = parseFloat(qLat);
                lon = parseFloat(qLon);
            }

            if (!lat || !lon) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }

            const cacheKey      = `tropo_v${CACHE_VERSION}_${Math.round(lat * 100)}_${Math.round(lon * 100)}_500`;
            const cachedDataStr = localStorage.getItem(cacheKey);
            let needsFetch      = true;

            if (cachedDataStr) {
                try {
                    const cached = JSON.parse(cachedDataStr);
                    if (Date.now() - cached.timestamp < CONFIG.cacheValidityMs) {
                        needsFetch        = false;
                        masterFetchStatus = 'ready';
                        updateAllButtons('ready');
                    }
                } catch (e) { }
            }

            if (needsFetch) {
                const ok = await fetchWithRetry(lat, lon);
                if (!ok) {
                    await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
                    continue;
                }
                updateCurrentTropoIndicator();
                if (TropoMapActive && container && container.style.display !== 'none' && !isFetchingData) {
                    loadDataForRadius(parseInt(lastSelectedRadius));
                }
            }

            // Sleep one hour then re-check
            await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000));
        }
    }

    // --- LOAD / DISPLAY DATA FOR A GIVEN RADIUS ---
    async function loadDataForRadius(radiusKm) {
        if (!mapInstance || isFetchingData) return;

        isFetchingData = true;
        localStorage.setItem('lastSelectedRadius', radiusKm);
        lastSelectedRadius = radiusKm;

        document.querySelectorAll('.radius-btn').forEach(b => {
            b.disabled      = true;
            b.style.opacity = '0.4';
            b.style.cursor  = 'not-allowed';
            b.classList.remove('color-4');
            b.innerHTML     = `${b.id.replace('btn-', '')}km`;
        });

        const activeBtn = document.getElementById(`btn-${radiusKm}`);
        if (activeBtn) {
            activeBtn.classList.add('color-4');
            activeBtn.style.opacity = '1';
            activeBtn.innerHTML     = `${radiusKm}km <span class="spin" style="font-size:10px">⟳</span>`;
        }

        const statusEl = document.getElementById('tropo-status-overlay');
        if (statusEl) {
            statusEl.innerHTML     = `<span class="spin">⟳</span> Fetching data...`;
            statusEl.style.display = 'block';
        }

        const wasPlaying = isPlaying;
        if (animationFrameId) { clearTimeout(animationFrameId); animationFrameId = null; }
        isPlaying = false;

        let center;
        const qLat = localStorage.getItem('qthLatitude');
        const qLon = localStorage.getItem('qthLongitude');

        if      (gpsData.status === 'active' && gpsData.lat && gpsData.lon) center = { lat: parseFloat(gpsData.lat), lng: parseFloat(gpsData.lon) };
        else if (qLat && qLon)                                               center = { lat: parseFloat(qLat),       lng: parseFloat(qLon) };
        else                                                                  center = mapInstance.getCenter();

        if      (gpsData.status === 'active' && gpsData.lat && gpsData.lon) drawPositionMarker(gpsData.lat, gpsData.lon);
        else if (qLat && qLon)                                               drawPositionMarker(qLat, qLon);

        try {
            const data = await fetchAndCacheTropoData(center.lat, center.lng);
            const grid = data.grid;

            if (weatherOverlayCanvas) {
                weatherOverlayCanvas.getContext('2d').clearRect(0, 0, weatherOverlayCanvas.width, weatherOverlayCanvas.height);
            }

            // Overlay always covers the full 500km extent for correct pixel mapping
            apiBounds = data.bounds;

            // Zoom viewport to requested radius, zero extra API calls
            const viewBounds = calculateBounds(center.lat, center.lng, radiusKm);
            mapInstance.fitBounds(
                L.latLngBounds([viewBounds.minLat, viewBounds.minLon], [viewBounds.maxLat, viewBounds.maxLon]),
                { padding: [0, 0], animate: false }
            );
            mapInstance.invalidateSize();

            // Build frames starting from the current UTC hour.
            // The server returns forecast_hours=12, so time[0] = current hour from the model.
            // We find the current hour in the array to skip any stale leading entries.
            const timeArray  = data.time;
            const nowUtc     = new Date();
            const nowIso     = nowUtc.toISOString().slice(0, 13) + ':00';
            const nowUtcHour = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), nowUtc.getUTCHours()));

            let startIdx = timeArray.findIndex(t => t === nowIso);
            if (startIdx < 0) startIdx = 0;

            frames = [];
            for (let h = 0; h < timeArray.length - startIdx; h++) {
                const hourIdx  = startIdx + h;
                if (hourIdx >= timeArray.length) break;
                const timeDate = new Date(timeArray[hourIdx] + 'Z');
                if (timeDate < nowUtcHour) continue; // skip past hours from stale cache

                frames.push({ time: timeDate, visValues: new Float32Array(grid[hourIdx]), renderedImage: null });
            }

            if (frames.length === 0 && timeArray.length > 0) {
                // All data is technically in the past
                const timeDate = new Date(timeArray[0] + 'Z');
                frames.push({ time: timeDate, visValues: new Float32Array(grid[0]), renderedImage: null });
            }

            lastHourChecked = getLastFullHour();

            const slider = document.getElementById('tropo-timeline');
            if (slider && frames.length > 0) {
                slider.max        = frames.length - 1;
                currentFrameIndex = 0;
                slider.value      = 0;
            }

            if (statusEl) statusEl.style.display = 'none';

            if (frames.length > 0) {
                renderFrame(currentFrameIndex);
                updateCurrentTropoIndicator();
                if (wasPlaying) { isPlaying = true; animationLoop(); }
                else            { updatePlayButton(); }
            } else {
                if (statusEl) { statusEl.innerText = "No data!"; statusEl.style.display = 'block'; }
            }

            if (masterFetchStatus === 'pending' || masterFetchStatus === 'loading') {
                masterFetchStatus = 'ready';
            }

            setTimeout(() => {
                isFetchingData = false;
                updateAllButtons(masterFetchStatus);
                document.querySelectorAll('.radius-btn').forEach(b => {
                    b.style.opacity = b.disabled ? '0.4' : '1';
                    b.style.cursor  = b.disabled ? 'not-allowed' : 'pointer';
                    b.classList.remove('color-4');
                });
                const reActiveBtn = document.getElementById(`btn-${radiusKm}`);
                if (reActiveBtn && !reActiveBtn.disabled) reActiveBtn.classList.add('color-4');
            }, data.fromCache ? 0 : 500);

        } catch (e) {
            console.error('[TropoForecast] Error:', e);
            if (statusEl) {
                statusEl.innerText = '\u26A0\uFE0F Unable to load forecast data. Please try again later.';
                setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
            }
            isFetchingData = false;
            updateAllButtons('error');
        }
    }

    // --- Drag & Drop ---
    function makeDraggable(el) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = document.getElementById("tropo-header");
        (header || el).onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            if (e.button !== 0) return;
            e.preventDefault();
            pos3 = e.clientX; pos4 = e.clientY;
            document.onmouseup   = closeDragElement;
            document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX;        pos4 = e.clientY;
            el.style.top  = (el.offsetTop  - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        }
        function closeDragElement() {
            document.onmouseup   = null;
            document.onmousemove = null;
            localStorage.setItem('tropoTop',  el.style.top);
            localStorage.setItem('tropoLeft', el.style.left);
        }
    }

    // --- UI CONSTRUCTION ---
    function createUI() {
        if (container) return;

        const style = document.createElement('style');
        style.innerHTML = `
            #tropo-overlay { position:fixed; display:none; width:440px; background-color:var(--color-1); color:#fff; font-family:sans-serif; border-radius:8px; z-index:9999; cursor:move; user-select:none; box-shadow:0 4px 12px rgba(0,0,0,0.5); border:1px solid #444; font-size:13px; overflow:hidden; isolation:isolate; }
            #tropo-header { background:#0a0a0a; padding:8px 15px; border-bottom:1px solid #444; font-weight:bold; border-radius:8px 8px 0 0; display:flex; justify-content:space-between; align-items:center; cursor:move; position:relative; gap:8px; z-index:10000; }
            #tropo-title { color:white; flex:1; }
            #tropo-close { cursor:pointer; font-weight:bold; color:#ccc; font-size:18px; line-height:1; padding:0 4px; margin-right:-10px; flex-shrink:0; }
            #tropo-close:hover { color:#fff; }
            #tropo-map-container { position:relative; z-index:1; }
            #tropo-map-container .leaflet-pane { z-index:auto; }
            #tropo-map-container .leaflet-top, #tropo-map-container .leaflet-bottom { z-index:2; }
            .high-contrast-map { filter: invert(100%) grayscale(100%) brightness(125%) contrast(110%) !important; }
            #tropo-content { padding:5px; background:#0a0a0a; border-top:1px solid #222; max-height:500px; overflow-y:auto; position:relative; z-index:10000; }
            input[type=range].tropo-slider { -webkit-appearance:none; width:100%; background:transparent; margin:0; }
            input[type=range].tropo-slider:focus { outline:none; }
            input[type=range].tropo-slider::-webkit-slider-thumb { -webkit-appearance:none; height:14px; width:14px; border-radius:50%; background:#fff; box-shadow:0 0 5px rgba(0,0,0,0.5); cursor:pointer; margin-top:-5px; }
            input[type=range].tropo-slider:disabled::-webkit-slider-thumb { background:#555; cursor:not-allowed; }
            input[type=range].tropo-slider::-webkit-slider-runnable-track { width:100%; height:4px; cursor:pointer; background:rgba(255,255,255,0.3); border-radius:2px; }
            input[type=range].tropo-slider:disabled::-webkit-slider-runnable-track { background:rgba(255,255,255,0.1); cursor:not-allowed; }

            /* Firefox // AAD */
            input[type=range].tropo-slider { -webkit-appearance: none; width: 100%; height: 4px; background: #333; margin: 0; }
            input[type=range].tropo-slider::-moz-range-thumb { width: 20px; background: #eee; }

            @keyframes spin { 100% { transform:rotate(360deg); } }
            .spin { display:inline-block; animation:spin 1s infinite linear; }
            .radius-btn { background:transparent; border:1px solid #444; color:#fff; padding:4px 8px; font-size:11px; cursor:pointer; border-radius:4px; transition:all 0.2s; min-width:45px; text-align:center; }
            .radius-btn:hover:not(:disabled) { border-color:#fff; }
            .radius-btn:disabled { opacity:0.4; cursor:not-allowed; color:#888; border-color:#333; }
            .radius-btn.color-4 { background-color:var(--color-4); color:#000; border-color:var(--color-4); font-weight:bold; }
            .play-btn { background:transparent; border:1px solid #444; color:#fff; font-size:11px; cursor:pointer; border-radius:4px; transition:all 0.2s; width:28px; height:28px; display:flex; align-items:center; justify-content:center; padding:0; flex-shrink:0; }
            .play-btn:hover { border-color:#fff; }
            .play-btn.color-4 { background-color:var(--color-4); color:#000; border-color:var(--color-4); font-weight:bold; }
            .legend-item { display:flex; flex-direction:column; align-items:center; width:100%; }
            .legend-color { width:100%; height:10px; margin-bottom:2px; }
            .legend-label { font-size:9px; color:#aaa; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            #tropo-map-container { height:100%; }
            #tropo-validation-badge { font-size:8px; color:#666; text-align:center; padding-top:8px; border-top:1px solid #333; cursor:help; }
        `;
        document.head.appendChild(style);

        container = document.createElement('div');
        container.id = 'tropo-overlay';

        let savedTop  = localStorage.getItem('tropoTop')  || '20px';
        let savedLeft = localStorage.getItem('tropoLeft') || '20px';
        if (parseInt(savedTop)  < 0 || parseInt(savedTop)  > window.innerHeight - 50) savedTop  = '20px';
        if (parseInt(savedLeft) < 0 || parseInt(savedLeft) > window.innerWidth  - 50) savedLeft = '20px';
        container.style.cssText = `position:fixed;top:${savedTop};left:${savedLeft};width:440px;height:625px;display:none;flex-direction:column;background:var(--color-1);z-index:19;isolation:isolate;`; // AAD

        const header = document.createElement('div');
        header.id        = 'tropo-header';
        header.innerHTML = `<span id="tropo-title">Tropo Forecast by Highpoint</span><span id="tropo-close" title="Close">&times;</span>`;
        container.appendChild(header);

        const mapDiv = document.createElement('div');
        mapDiv.id            = 'tropo-map-container';
        mapDiv.style.cssText = "flex:1;position:relative;background:#000;";
        container.appendChild(mapDiv);

        const statusOverlay = document.createElement('div');
        statusOverlay.id            = 'tropo-status-overlay';
        statusOverlay.style.cssText = "position:absolute;top:50px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);padding:8px 20px;border-radius:20px;color:white;font-size:13px;z-index:10001;display:none;border:1px solid #444;pointer-events:none;";
        mapDiv.appendChild(statusOverlay);

        const controls = document.createElement('div');
        controls.id = 'tropo-content';

        const topControls = document.createElement('div');
        topControls.style.cssText = "display:flex;align-items:center;margin-bottom:10px;gap:8px;";
        topControls.innerHTML = `
            <button id="tropo-play-btn" class="play-btn" title="Play">▶</button>
            <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa;margin-bottom:-6px;">
                    <span id="tropo-date">--</span>
                    <span style="color:white;font-weight:bold;" id="tropo-clock" title="UTC Time">--:-- UTC</span>
                    <span id="tropo-offset" style="color:var(--color-4);">(+0h)</span>
                </div>
                <input type="range" id="tropo-timeline" class="tropo-slider" min="0" max="11" value="0">
            </div>
        `;
        controls.appendChild(topControls);

        const radiusControls = document.createElement('div');
        radiusControls.style.cssText = "display:flex;gap:5px;margin-bottom:10px;";
        radiusControls.innerHTML = [100, 200, 300, 400, 500]
            .map(r => `<button class="radius-btn" id="btn-${r}"></button>`)
            .join('');
        controls.appendChild(radiusControls);

        const legend = document.createElement('div');
        legend.style.cssText = "display:flex;gap:1px;margin-top:5px;background:#000;padding:5px;border-radius:4px;";
        legend.innerHTML = PALETTE.slice(1).map((p, i) => `
            <div class="legend-item">
                <div class="legend-color" style="background:${p.color};"></div>
                <div class="legend-label">${p.label}</div>
            </div>
        `).join('');
        controls.appendChild(legend);

        const validationBadge = document.createElement('div');
        validationBadge.id        = 'tropo-validation-badge';
        validationBadge.title     = 'Current Position';
        validationBadge.innerHTML = '--';
        controls.appendChild(validationBadge);

        container.appendChild(controls);
        document.body.appendChild(container);

        if (!locationName) {
            const _lat = localStorage.getItem('qthLatitude');
            const _lon = localStorage.getItem('qthLongitude');
            if (_lat && _lon) {
                const _key = `tropo_v${CACHE_VERSION}_${Math.round(parseFloat(_lat) * 100)}_${Math.round(parseFloat(_lon) * 100)}_500`;
                try { const _c = JSON.parse(localStorage.getItem(_key)); if (_c && _c.locationName) locationName = _c.locationName; if (_c && _c.forecastHours) forecastHours = _c.forecastHours; } catch {}
            }
        }
        updateHeaderCoordinates();
        updateAllButtons(masterFetchStatus);

        makeDraggable(container);

        mapInstance = L.map('tropo-map-container', {
            center: [51.29, 12.44], zoom: 7,
            zoomControl: false, attributionControl: false, zoomSnap: 0,
            scrollWheelZoom: false, dragging: false, touchZoom: false, doubleClickZoom: false
        });

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19, className: 'high-contrast-map'
		}).addTo(mapInstance);

        L.CanvasOverlay = L.Layer.extend({
            onAdd(map) {
                this._map    = map;
                this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer');
                this._canvas.style.pointerEvents = 'none';
                const size   = map.getSize();
                this._canvas.width  = size.x;
                this._canvas.height = size.y;
                const animated = map.options.zoomAnimation && L.Browser.any3d;
                L.DomUtil.addClass(this._canvas, 'leaflet-zoom-' + (animated ? 'animated' : 'hide'));
                map._panes.overlayPane.appendChild(this._canvas);
                map.on('moveend', this._reset,  this);
                map.on('resize',  this._resize, this);
                weatherOverlayCanvas = this._canvas;
            },
            onRemove(map) {
                map.getPanes().overlayPane.removeChild(this._canvas);
                map.off('moveend', this._reset,  this);
                map.off('resize',  this._resize, this);
            },
            _reset() {
                L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]));
                this._redraw();
            },
            _resize(e) {
                this._canvas.width  = e.newSize.x;
                this._canvas.height = e.newSize.y;
                this._reset();
            },
            _redraw() {
                if (frames[currentFrameIndex] && frames[currentFrameIndex].renderedImage) {
                    drawOnMap(frames[currentFrameIndex].renderedImage);
                }
            }
        });
        mapInstance.addLayer(new L.CanvasOverlay());

        document.addEventListener('keydown', e => {
            if (TropoMapActive && (e.key === '+' || e.key === '-' || e.code === 'Equal' || e.code === 'Minus')) {
                e.preventDefault();
            }
        }, true);

        const qLat = localStorage.getItem('qthLatitude');
        const qLon = localStorage.getItem('qthLongitude');
        if      (gpsData.status === 'active' && gpsData.lat && gpsData.lon) mapInstance.setView([parseFloat(gpsData.lat), parseFloat(gpsData.lon)], 7);
        else if (qLat && qLon)                                               mapInstance.setView([parseFloat(qLat), parseFloat(qLon)], 7);
        else                                                                  mapInstance.setView([51.29, 12.44], 7);

        document.getElementById('tropo-close').addEventListener('click', () => {
            const btn = document.getElementById('TROPO-BTN');
            if (btn) btn.click();
        });
        document.getElementById('tropo-play-btn').addEventListener('click', togglePlay);
        document.getElementById('tropo-timeline').addEventListener('input', e => {
            isPlaying = false;
            if (animationFrameId) { clearTimeout(animationFrameId); animationFrameId = null; }
            updatePlayButton();
            renderFrame(parseInt(e.target.value));
        });
        [100, 200, 300, 400, 500].forEach(km => {
            document.getElementById(`btn-${km}`).addEventListener('click', () => loadDataForRadius(km));
        });
    }

    function togglePlugin() {
        TropoMapActive = !TropoMapActive;
        const btn = document.getElementById('TROPO-BTN');

        if (TropoMapActive) {
            loadLeaflet(() => {
                createUI();
                if (btn) btn.classList.add('active');

                const $overlay = $('#tropo-overlay');
                $overlay.css({ display: 'flex', opacity: 0 });

                setTimeout(() => {
                    if (mapInstance) {
                        mapInstance.invalidateSize();
                        $overlay.animate({ opacity: 1 }, 600);
                        if (!isFetchingData) loadDataForRadius(parseInt(lastSelectedRadius));
                    }
                }, 100);

                lastHourChecked = getLastFullHour();
                if (hourUpdateInterval)   clearInterval(hourUpdateInterval);
                hourUpdateInterval = setInterval(checkHourChange, 60000);

                if (headerUpdateInterval) clearInterval(headerUpdateInterval);
                headerUpdateInterval = setInterval(updateHeaderCoordinates, 2000);
            });
        } else {
            if (btn) btn.classList.remove('active');

            $('#tropo-overlay').animate({ opacity: 0 }, 600, function () {
                $(this).css('display', 'none');
                if (weatherOverlayCanvas) {
                    weatherOverlayCanvas.getContext('2d').clearRect(0, 0, weatherOverlayCanvas.width, weatherOverlayCanvas.height);
                }
                frames = []; currentFrameIndex = 0;
                updateCurrentTropoIndicator();
            });

            isPlaying = false;
            if (animationFrameId)     { clearTimeout(animationFrameId);     animationFrameId     = null; }
            if (hourUpdateInterval)   { clearInterval(hourUpdateInterval);   hourUpdateInterval   = null; }
            if (headerUpdateInterval) { clearInterval(headerUpdateInterval); headerUpdateInterval = null; }
        }
    }

    // --- Plugin Panel Button ---
    (function () {
        const btnId = 'TROPO-BTN';
        let found   = false;
        const obs   = new MutationObserver((_, o) => {
            if (typeof addIconToPluginPanel === 'function') {
                found = true;
                o.disconnect();
                addIconToPluginPanel(btnId, 'Tropo', 'solid', 'mountain', `Plugin Version: ${pluginVersion}`);

                const btnObs = new MutationObserver((_, o2) => {
                    const $btn = $(`#${btnId}`);
                    $btn.addClass("hide-phone bg-color-2");
                    if ($btn.length) {
                        o2.disconnect();
                        $("<style>").prop("type", "text/css").html(`
                            #${btnId}:hover { color:var(--color-5); filter:brightness(120%); }
                            #${btnId}.active { background-color:var(--color-2)!important; filter:brightness(120%); }
                        `).appendTo("head");
                        $btn.on('click', togglePlugin);
                        updateCurrentTropoIndicator();
                        setInterval(updateCurrentTropoIndicator, 15 * 60 * 1000);
                    }
                });
                btnObs.observe(document.body, { childList: true, subtree: true });
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { if (!found) obs.disconnect(); }, 10000);
    })();

    function checkAdmin() {
        const text = document.body.textContent || document.body.innerText;
        isAuth = text.includes('You are logged in as an administrator.')
               || text.includes('You are logged in as an adminstrator.');
        console.log(isAuth ? '[TropoForecast] Admin OK' : '[TropoForecast] Admin failed');
    }

    setupWebSocket();
    checkAdmin();
    startBackgroundWorker();

})();
