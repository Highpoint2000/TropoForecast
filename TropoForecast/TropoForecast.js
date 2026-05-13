(() => {

    ////////////////////////////////////////////////////////////////
    ///                                                          ///
    ///  TROPO FORECAST PLUGIN FOR FM-DX-WEBSERVER        V1.2   ///
    ///                                                          ///
    ///  by Highpoint                last update: 2026-05-13     ///
    ///                                                          ///
    ///  https://github.com/Highpoint2000/TropoForecast          ///
    ///                                                          ///
    ////////////////////////////////////////////////////////////////

    // ------------- Configuration ----------------
    const pluginSetupOnlyNotify = false;
    const CHECK_FOR_UPDATES = true;

    // Plugin metadata
    const pluginVersion = '1.2';
    const CACHE_VERSION = pluginVersion;
    const pluginName = "TropoForecast";
    const pluginHomepageUrl = "https://github.com/Highpoint2000/TropoForecast/releases";
    const pluginUpdateUrl = "https://raw.githubusercontent.com/Highpoint2000/TropoForecast/main/TropoForecast/TropoForecast.js";
    let isAuth = false;

    // WebSocket endpoint for GPS data
    const url = new URL(window.location.href);
    const host = url.hostname;
    const path = url.pathname.replace(/setup/g, '');
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const WS_URL = `${proto}//${host}:${port}${path}data_plugins`;
    let ws = null;

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
                ws.addEventListener('open', () => console.log('[TropoForecast] WebSocket connected'));
                ws.addEventListener('message', handleMessage);
                ws.addEventListener('error', e => console.error('[TropoForecast] WebSocket error'));
                ws.addEventListener('close', () => setTimeout(setupWebSocket, 5000));
            } catch (err) { setTimeout(setupWebSocket, 5000); }
        }
    }

    function handleMessage(evt) {
        try {
            const msg = JSON.parse(evt.data);
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
        masterRadius:    500,   // The one and only radius that is actually downloaded
        defaultRadius:   500,
        blurAmount:      'blur(1.2px)',
        opacity:         0.80,
        cacheValidityMs: 3600000 // 1 hour
    };

    const PALETTE = [
        {color: 'rgba(0,0,0,0)',        label: ''},
        {color: 'rgba(134,3,241,0.8)',  label: 'Marginal'},
        {color: 'rgba(1,180,239,0.8)',  label: 'Fair'},
        {color: 'rgba(2,208,131,0.9)',  label: 'Moderate'},
        {color: 'rgba(165,235,1,0.9)',  label: 'Good'},
        {color: 'rgba(239,222,5,0.9)',  label: 'Very Good'},
        {color: 'rgba(233,177,12,1.0)', label: 'Excellent'},
        {color: 'rgba(255,128,0,1.0)',  label: 'Intense'},
        {color: 'rgba(255,0,0,1.0)',    label: 'Extreme'},
        {color: 'rgba(255,128,192,1.0)',label: 'Extreme+'},
        {color: 'rgba(255,180,220,1.0)',label: 'Max'}
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
    let isApiBusy            = false;

    let lastIndicatorFetchTime = 0;
    let lastIndicatorLat     = null;
    let lastIndicatorLon     = null;
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
            if (state === 'pending' || state === 'loading_current') {
                masterBtn.disabled  = true;
                masterBtn.innerHTML = `500km <span class="spin" style="font-size:10px">⟳</span>`;
                masterBtn.title     = "Downloading 500km master data...";
            } else if (state === 'ready_current') {
                masterBtn.disabled  = false;
                masterBtn.innerHTML = `500km <span style="font-size:9px;color:#aaa;font-weight:normal">(1h)</span>`;
                masterBtn.title     = "Display 500km (Current Hour Only)";
            } else if (state === 'loading_full') {
                masterBtn.disabled  = false;
                masterBtn.innerHTML = `500km <span class="spin" style="font-size:10px;color:#aaa">⟳</span>`;
                masterBtn.title     = "Display 500km (Downloading 48h forecast...)";
            } else if (state === 'ready') {
                masterBtn.disabled  = false;
                masterBtn.innerHTML = `500km`;
                masterBtn.title     = "Display 500km forecast (48h)";
            } else if (state === 'error') {
                masterBtn.disabled  = true;
                masterBtn.innerHTML = `500km ⚠️`;
                masterBtn.title     = "API Hourly/Daily Limit Reached.";
            } else if (state === 'retrying') {
                masterBtn.disabled  = true;
                masterBtn.innerHTML = `500km ⏳`;
                masterBtn.title     = "Retrying API request...";
            }
        }

// Sub-radius buttons: always reset label text (no color-4 guard) so spinners never stick
const subReady = (state === 'ready_current' || state === 'loading_full' || state === 'ready');
  [100, 200, 300, 400].forEach(r => {
    const btn = document.getElementById(`btn-${r}`);
    if (!btn) return;
    btn.disabled  = !subReady;
    btn.innerHTML = `${r}km`;

    // While the background is still downloading the full 48h forecast,
    // keep whichever indicator is currently on the active button:
    //   ⏳  during the post-fetch cooldown second
    //   ⟳  the rest of the time
    if (state === 'loading_full' && parseInt(lastSelectedRadius) === r) {
        const hasHourglass = btn.innerHTML.includes('⏳');
        btn.innerHTML = hasHourglass
            ? `${r}km ⏳`
            : `${r}km <span class="spin" style="font-size:10px;color:#aaa">⟳</span>`;
    }

    btn.title = subReady
        ? `Zoom to ${r}km (uses 500km master data – no extra API calls)`
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

    // --- PHYSICS ENGINE ---
    function calcVaporPressure(tempC, rh) {
        const es = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
        return es * (rh / 100.0);
    }

    function calcN(tempC, rh, pressureHPa) {
        const tempK = tempC + 273.15;
        const e     = calcVaporPressure(tempC, rh);
        return (77.6 / tempK) * (pressureHPa + 4810 * (e / tempK));
    }

    function calcWindShear(uLow, vLow, uUp, vUp, dh) {
        const du = uUp - uLow;
        const dv = vUp - vLow;
        return Math.sqrt(du * du + dv * dv) / dh;
    }

    function calculateTropoIndexPrecise(hourly, idx) {
        const levels  = [1000, 975, 950, 925, 900, 875, 850];
        const heights = { 1000: 0.11, 975: 0.32, 950: 0.54, 925: 0.76, 900: 0.99, 875: 1.22, 850: 1.46 };
        let maxGradientMag     = 0;
        let shearAtMaxGradient = 0;

        for (let i = 0; i < levels.length - 1; i++) {
            const lowerP = levels[i];
            const upperP = levels[i + 1];
            if (!hourly[`temperature_${lowerP}hPa`] || !hourly[`temperature_${upperP}hPa`]) continue;

            const tLow  = hourly[`temperature_${lowerP}hPa`][idx];
            const rhLow = hourly[`relative_humidity_${lowerP}hPa`][idx];
            const tUp   = hourly[`temperature_${upperP}hPa`][idx];
            const rhUp  = hourly[`relative_humidity_${upperP}hPa`][idx];

            if (tLow === undefined || tUp === undefined || rhLow === undefined || rhUp === undefined) continue;

            const nLow     = calcN(tLow, rhLow, lowerP);
            const nUp      = calcN(tUp,  rhUp,  upperP);
            const dh       = heights[upperP] - heights[lowerP];
            const gradient = (nUp - nLow) / dh;

            if (gradient < -60 && Math.abs(gradient) > maxGradientMag) {
                maxGradientMag = Math.abs(gradient);

                const wsLow = hourly[`wind_speed_${lowerP}hPa`]     ? hourly[`wind_speed_${lowerP}hPa`][idx]     : undefined;
                const wdLow = hourly[`wind_direction_${lowerP}hPa`] ? hourly[`wind_direction_${lowerP}hPa`][idx] : undefined;
                const wsUp  = hourly[`wind_speed_${upperP}hPa`]     ? hourly[`wind_speed_${upperP}hPa`][idx]     : undefined;
                const wdUp  = hourly[`wind_direction_${upperP}hPa`] ? hourly[`wind_direction_${upperP}hPa`][idx] : undefined;

                if (wsLow !== undefined && wdLow !== undefined && wsUp !== undefined && wdUp !== undefined) {
                    const wdLowRad = (wdLow * Math.PI) / 180;
                    const wdUpRad  = (wdUp  * Math.PI) / 180;
                    const uLow = -wsLow * Math.sin(wdLowRad);
                    const vLow = -wsLow * Math.cos(wdLowRad);
                    const uUp  = -wsUp  * Math.sin(wdUpRad);
                    const vUp  = -wsUp  * Math.cos(wdUpRad);
                    shearAtMaxGradient = calcWindShear(uLow, vLow, uUp, vUp, dh);
                }
            }
        }

        if (maxGradientMag < 60) return 0;
        let index = (maxGradientMag - 60) / 20;

        if (shearAtMaxGradient > 5) {
            let shearBonus;
            if      (shearAtMaxGradient <= 20) shearBonus = ((shearAtMaxGradient - 5)  / 15) * 2.0;
            else if (shearAtMaxGradient <= 30) shearBonus = 2.0 - ((shearAtMaxGradient - 20) / 10) * 1.0;
            else                               shearBonus = 1.0;
            index += shearBonus;
        }
        return Math.max(0, Math.min(10, index));
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

        // Fast path: use already-rendered frame data
        if (apiBounds && frames.length > 0 && frames[currentFrameIndex]) {
            const val  = interpolateGridValue(lat, lon, frames[currentFrameIndex].visValues, apiBounds, getGridSize());
            const idx  = val > 0.5 ? Math.round(val) : 0;
            const cIdx = Math.max(0, Math.min(idx, 10));
            applyIndicatorColor(PALETTE[cIdx].color, PALETTE[cIdx].label, idx);
            return;
        }

        // Cache path: look up the 500km master cache
        const cacheKey      = `tropo_v${CACHE_VERSION}_${Math.round(lat * 100)}_${Math.round(lon * 100)}_500`;
        const cachedDataStr = localStorage.getItem(cacheKey);

        if (cachedDataStr) {
            try {
                const cached = JSON.parse(cachedDataStr);
                const bounds = calculateBounds(lat, lon, 500);
                if (cached.frames && cached.frames.length > 0) {
                    const currentIso  = new Date().toISOString().slice(0, 13) + ':00';
                    const targetFrame = cached.frames.find(f => f.time === currentIso) || cached.frames[0];
                    const val         = interpolateGridValue(lat, lon, targetFrame.visValues, bounds, getGridSize());
                    const idx         = val > 0.5 ? Math.round(val) : 0;
                    const cIdx        = Math.max(0, Math.min(idx, 10));
                    applyIndicatorColor(PALETTE[cIdx].color, PALETTE[cIdx].label, idx);
                    return;
                }
            } catch (e) { }
        }

        // Fallback: single-point fetch (1 API call, max once per 15 min per location)
        const now        = Date.now();
        const locChanged = lastIndicatorLat === null
            || Math.abs(lastIndicatorLat - lat) > 0.05
            || Math.abs(lastIndicatorLon - lon) > 0.05;
        if (!locChanged && (now - lastIndicatorFetchTime < 15 * 60 * 1000)) return;

        lastIndicatorFetchTime = now;
        lastIndicatorLat       = lat;
        lastIndicatorLon       = lon;

        try {
            const levels = [1000, 975, 950, 925, 900, 875, 850];
            const params = [];
            levels.forEach(l => {
                params.push(`temperature_${l}hPa`);
                params.push(`relative_humidity_${l}hPa`);
                params.push(`wind_speed_${l}hPa`);
                params.push(`wind_direction_${l}hPa`);
            });

            const fetchUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${params.join(',')}&forecast_hours=1&models=best_match`;
            const resp     = await fetch(fetchUrl);
            if (!resp.ok) return;
            const json = await resp.json();

            if (json && json.hourly && json.hourly.time) {
                const indexVal = calculateTropoIndexPrecise(json.hourly, 0);
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
            indicator.style.backgroundColor = 'rgba(255,255,255,0.15)';
            indicator.title = 'Current Tropo: None/Marginal';
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
            if (frames.length === 1) {
                offsetEl.innerText   = `(+0h) - Loading 48h...`;
                offsetEl.style.color = '#aaa';
            } else {
                offsetEl.innerText   = `(+${index}h)`;
                offsetEl.style.color = 'var(--color-4)';
            }
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
        if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
            badgeEl.textContent = `${parseFloat(gpsData.lat).toFixed(5)}° / ${parseFloat(gpsData.lon).toFixed(5)}° (GPS)`;
        } else if (qthLat && qthLon) {
            badgeEl.textContent = `${parseFloat(qthLat).toFixed(5)}° / ${parseFloat(qthLon).toFixed(5)}° (QTH)`;
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

// --- API FETCHING ---
async function fetchAndCacheTropoData(centerLat, centerLon, fetchMode = 'full') {

    // ── FAST PATH: return cache immediately, no lock needed ──────────────
    const radiusKm  = CONFIG.masterRadius;
    const bounds    = calculateBounds(centerLat, centerLon, radiusKm);
    const cacheKey  = `tropo_v${CACHE_VERSION}_${Math.round(centerLat * 100)}_${Math.round(centerLon * 100)}_500`;
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
        try {
            const cached   = JSON.parse(cachedRaw);
            const fresh    = Date.now() - cached.timestamp < CONFIG.cacheValidityMs;
            const adequate = fetchMode === 'current' || cached.isFull;
            if (fresh && adequate) {
                return { frames: cached.frames, bounds, fromCache: true };
            }
        } catch (e) { }
    }
    // ─────────────────────────────────────────────────────────────────────

    while (isApiBusy) {
        await new Promise(r => setTimeout(r, 500));
    }
    isApiBusy = true;

    try {
        // re-check cache now that we hold the lock (another caller may have
        // populated it while we were waiting)
        const cachedRaw2 = localStorage.getItem(cacheKey);
        if (cachedRaw2) {
            try {
                const cached   = JSON.parse(cachedRaw2);
                const fresh    = Date.now() - cached.timestamp < CONFIG.cacheValidityMs;
                const adequate = fetchMode === 'current' || cached.isFull;
                if (fresh && adequate) {
                    return { frames: cached.frames, bounds, fromCache: true };
                }
            } catch (e) { }
        }

        // Build 13×13 = 169 coordinate list
        const gridSize = getGridSize();
        const apiLats  = [];
        const apiLons  = [];
        for (let y = 0; y < gridSize; y++) {
            const lat = bounds.minLat + (y / (gridSize - 1)) * (bounds.maxLat - bounds.minLat);
            for (let x = 0; x < gridSize; x++) {
                const lon = bounds.minLon + (x / (gridSize - 1)) * (bounds.maxLon - bounds.minLon);
                apiLats.push(lat.toFixed(2));
                apiLons.push(lon.toFixed(2));
            }
        }

        const levels = [1000, 975, 950, 925, 900, 875, 850];
        const params  = [];
        levels.forEach(l => {
            params.push(`temperature_${l}hPa`);
            params.push(`relative_humidity_${l}hPa`);
            params.push(`wind_speed_${l}hPa`);
            params.push(`wind_direction_${l}hPa`);
        });

        const chunkSize = 25;
        const timeParam = fetchMode === 'current' ? 'forecast_hours=6' : 'forecast_days=2';
        const results   = [];

        for (let i = 0; i < apiLats.length; i += chunkSize) {
            const lats     = apiLats.slice(i, i + chunkSize);
            const lons     = apiLons.slice(i, i + chunkSize);
            const fetchUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${params.join(',')}&${timeParam}&models=best_match`;

            const resp = await fetch(fetchUrl);
            if (!resp.ok) {
                if (resp.status === 429) throw new Error("API Limit (429): Please wait.");
                throw new Error(`API Error: ${resp.status}`);
            }
            const json = await resp.json();
            if (Array.isArray(json)) results.push(...json);
            else if (json.hourly)    results.push(json);

            if (i + chunkSize < apiLats.length) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        const framesData = [];
        if (results.length > 0 && results[0].hourly && results[0].hourly.time) {
            const utcNow     = new Date();
            const currentIso = utcNow.toISOString().slice(0, 13) + ':00';
            let startIdx     = results[0].hourly.time.findIndex(t => t === currentIso);
            if (startIdx === -1) startIdx = utcNow.getUTCHours();

            const maxFrames = fetchMode === 'current' ? 1 : 48;
            const maxLen    = results[0].hourly.time.length;

            for (let h = 0; h < maxFrames; h++) {
                const hourIdx = startIdx + h;
                if (hourIdx >= maxLen) break;

                const visValues = results.map(r =>
                    (r && r.hourly) ? calculateTropoIndexPrecise(r.hourly, hourIdx) : 0
                );
                framesData.push({ time: results[0].hourly.time[hourIdx], visValues });
            }
        }

        const cachePayload = JSON.stringify({
            frames:    framesData,
            bounds,
            isFull:    fetchMode === 'full',
            timestamp: Date.now()
        });
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

        return { frames: framesData, bounds, fromCache: false };

    } finally {
        isApiBusy = false;
    }
}

    async function fetchWithRetry(lat, lon, mode) {
        let attempt     = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
            const state = attempt === 0
                ? (mode === 'current' ? 'loading_current' : 'loading_full')
                : 'retrying';
            updateAllButtons(state);

            try {
                await fetchAndCacheTropoData(lat, lon, mode);
                updateAllButtons(mode === 'current' ? 'ready_current' : 'ready');
                return true;
            } catch (e) {
                attempt++;
                console.error(`[TropoForecast] Fetch failed [${mode}] (attempt ${attempt}/${maxAttempts}):`, e);
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
    // Downloads ONLY the 500km master canvas; all sub-radius views are derived from it.
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
            let needsCurrent    = true;
            let needsFull       = true;

            if (cachedDataStr) {
                try {
                    const cached = JSON.parse(cachedDataStr);
                    if (Date.now() - cached.timestamp < CONFIG.cacheValidityMs) {
                        needsCurrent      = false;
                        needsFull         = !cached.isFull;
                        masterFetchStatus = cached.isFull ? 'ready' : 'ready_current';
                        updateAllButtons(masterFetchStatus);
                    }
                } catch (e) { }
            }

            let failed = false;

            // Phase 1: fast single-hour snapshot so buttons unlock quickly
            if (needsCurrent) {
                const ok = await fetchWithRetry(lat, lon, 'current');
                if (!ok) {
                    failed = true;
                } else if (TropoMapActive && container && container.style.display !== 'none' && !isFetchingData) {
                    loadDataForRadius(parseInt(lastSelectedRadius));
                }
            }

            // Phase 2: full 48h forecast
            // Wait for any user interaction to finish before proceeding
            if (!failed) {
                while (isFetchingData) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (needsFull) {
                    const ok = await fetchWithRetry(lat, lon, 'full');
                    if (!ok) {
                        failed = true;
                    } else if (TropoMapActive && container && container.style.display !== 'none' && !isFetchingData) {
                        loadDataForRadius(parseInt(lastSelectedRadius));
                    }
                }
            }

            if (failed) {
                await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
                continue;
            }

            // All data fresh – sleep one hour
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
        const data = await fetchAndCacheTropoData(center.lat, center.lng, 'current');

        if (weatherOverlayCanvas) {
            weatherOverlayCanvas.getContext('2d').clearRect(0, 0, weatherOverlayCanvas.width, weatherOverlayCanvas.height);
        }

        // Overlay always covers the full 500km extent for correct pixel mapping
        apiBounds = data.bounds;

        // Zoom viewport to requested radius – zero extra API calls
        const viewBounds = calculateBounds(center.lat, center.lng, radiusKm);
        mapInstance.fitBounds(
            L.latLngBounds([viewBounds.minLat, viewBounds.minLon], [viewBounds.maxLat, viewBounds.maxLon]),
            { padding: [0, 0], animate: false }
        );
        mapInstance.invalidateSize();

        const now            = new Date();
        const currentUtcTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));

        frames = data.frames
            .map(f => ({ time: new Date(f.time + 'Z'), visValues: new Float32Array(f.visValues), renderedImage: null }))
            .filter(f => f.time >= currentUtcTime);

        if (frames.length === 0 && data.frames.length > 0) {
            frames = data.frames.map(f => ({
                time: new Date(f.time + 'Z'), visValues: new Float32Array(f.visValues), renderedImage: null
            }));
        }

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

        const cooldownTime = data.fromCache ? 0 : 1000;
        if (cooldownTime > 0 && activeBtn) activeBtn.innerHTML = `${radiusKm}km ⏳`;

        // If we successfully loaded displayable data but the background worker
        // hasn't promoted the status yet, promote it now so buttons unlock immediately.
        if (frames.length > 0 && (masterFetchStatus === 'pending' || masterFetchStatus === 'loading_current')) {
            masterFetchStatus = 'ready_current';
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
        }, cooldownTime);

    } catch (e) {
        console.error('[TropoForecast] Error:', e);
        if (statusEl) {
            statusEl.innerText = '⚠️ API Error (Limit Reached). Wait 1 Hour.';
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
            .high-contrast-map { filter:brightness(3) contrast(1) !important; }
            #tropo-content { padding:5px; background:#0a0a0a; border-top:1px solid #222; max-height:500px; overflow-y:auto; position:relative; z-index:10000; }
            input[type=range].tropo-slider { -webkit-appearance:none; width:100%; background:transparent; margin:0; }
            input[type=range].tropo-slider:focus { outline:none; }
            input[type=range].tropo-slider::-webkit-slider-thumb { -webkit-appearance:none; height:14px; width:14px; border-radius:50%; background:#fff; box-shadow:0 0 5px rgba(0,0,0,0.5); cursor:pointer; margin-top:-5px; }
            input[type=range].tropo-slider:disabled::-webkit-slider-thumb { background:#555; cursor:not-allowed; }
            input[type=range].tropo-slider::-webkit-slider-runnable-track { width:100%; height:4px; cursor:pointer; background:rgba(255,255,255,0.3); border-radius:2px; }
            input[type=range].tropo-slider:disabled::-webkit-slider-runnable-track { background:rgba(255,255,255,0.1); cursor:not-allowed; }
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
        container.style.cssText = `position:fixed;top:${savedTop};left:${savedLeft};width:440px;height:625px;display:none;flex-direction:column;background:var(--color-1);z-index:9999;isolation:isolate;`;

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
                <input type="range" id="tropo-timeline" class="tropo-slider" min="0" max="47" value="0">
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
                <div style="font-size:11px;font-weight:bold;color:#fff;margin-bottom:2px;">+${i + 1}</div>
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

        updateHeaderCoordinates();
        updateAllButtons(masterFetchStatus);

        makeDraggable(container);

        mapInstance = L.map('tropo-map-container', {
            center: [51.29, 12.44], zoom: 7,
            zoomControl: false, attributionControl: false, zoomSnap: 0,
            scrollWheelZoom: false, dragging: false, touchZoom: false, doubleClickZoom: false
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
            maxZoom: 19, subdomains: 'abcd', className: 'high-contrast-map'
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
            updateCurrentTropoIndicator();
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