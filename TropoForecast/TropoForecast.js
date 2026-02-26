(() => {
    ////////////////////////////////////////////////////////////////
    ///                                                          ///
    ///  TROPO FORECAST PLUGIN FOR FM-DX-WEBSERVER (V1.0)       ///
    ///                                                          ///
    ///  by Highpoint                last update: 2026-02-26     ///
    ///                                                          ///
    ///  https://github.com/Highpoint2000/TropoForecast         ///
    ///                                                          ///
    ////////////////////////////////////////////////////////////////

    // ------------- Configuration ----------------
    const pluginSetupOnlyNotify = false; // Changed to false to show updates outside of /setup
    const CHECK_FOR_UPDATES = true;

    ///////////////////////////////////////////////////////////////

    // Plugin metadata
    const pluginVersion = '1.0';
	const CACHE_VERSION = pluginVersion;
    const pluginName = "TropoForecast";
    const pluginHomepageUrl = "https://github.com/Highpoint2000/TropoForecast/releases";
    // Corrected URL: Added the missing /TropoForecast/ subfolder
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

    // ------------------------------------------------------------------
    // Fallback for sendToast() if not provided by the main webserver UI
    // ------------------------------------------------------------------
    if (typeof sendToast !== "function") {
        window.sendToast = function (cls, src, txt) {
            console.log(`[TOAST-Fallback] ${src}: ${cls} → ${txt}`);
        };
    }

    // Function for update notification in /setup
    function checkUpdate(setupOnly, pluginName, urlUpdateLink, urlFetchLink) {
        if (setupOnly && window.location.pathname !== '/setup') return;

        let pluginVersionCheck = typeof pluginVersion !== 'undefined' ? pluginVersion : typeof plugin_version !== 'undefined' ? plugin_version : typeof PLUGIN_VERSION !== 'undefined' ? PLUGIN_VERSION : 'Unknown';

        // Function to check for updates
        async function fetchFirstLine() {
            // Added cache buster to the URL
            const urlCheckForUpdate = urlFetchLink + '?t=' + new Date().getTime();
            try {
                // Added { cache: 'no-store' } to strictly bypass the browser cache
                const response = await fetch(urlCheckForUpdate, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`[${pluginName}] update check HTTP error! status: ${response.status}`);
                }
                const text = await response.text();
                const lines = text.split('\n');
                let version;
                if (lines.length > 2) {
                    const versionLine = lines.find(line => line.includes("const pluginVersion =") || line.includes("const plugin_version =") || line.includes("const PLUGIN_VERSION ="));
                    if (versionLine) {
                        const match = versionLine.match(/const\s+(?:pluginVersion|plugin_version|PLUGIN_VERSION)\s*=\s*['"]([^'"]+)['"]/);
                        if (match) {
                            version = match[1];
                        }
                    }
                }
                if (!version) {
                    const firstLine = lines[0].trim();
                    version = /^\d/.test(firstLine) ? firstLine : "Unknown";
                }
                return version;
            } catch (error) {
                console.error(`[${pluginName}] error fetching file:`, error);
                return null;
            }
        }

        // Check for updates
        fetchFirstLine().then(newVersion => {
            if (newVersion) {
                if (newVersion !== pluginVersionCheck) {
                    let updateConsoleText = "There is a new version of this plugin available";
                    console.log(`[${pluginName}] ${updateConsoleText}`);
                    setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink);
                }
            }
        });

        function setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink) {
            if (window.location.pathname === '/setup') {
                const pluginSettings = document.getElementById('plugin-settings');
                if (pluginSettings) {
                    const currentText = pluginSettings.textContent.trim();
                    const newText = `<a href="${urlUpdateLink}" target="_blank">[${pluginName}] Update available: ${pluginVersionCheck} --> ${newVersion}</a><br>`;

                    if (currentText === 'No plugin settings are available.') {
                        pluginSettings.innerHTML = newText;
                    } else {
                        pluginSettings.innerHTML += ' ' + newText;
                    }
                }

                const updateIcon = document.querySelector('.wrapper-outer #navigation .sidenav-content .fa-puzzle-piece') || document.querySelector('.wrapper-outer .sidenav-content') || document.querySelector('.sidenav-content');
                const redDot = document.createElement('span');
                redDot.style.display = 'block';
                redDot.style.width = '12px';
                redDot.style.height = '12px';
                redDot.style.borderRadius = '50%';
                redDot.style.backgroundColor = '#FE0830';
                redDot.style.marginLeft = '82px';
                redDot.style.marginTop = '-12px';
                updateIcon.appendChild(redDot);
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
                ws.addEventListener('error', e => console.error('[TropoForecast] WebSocket error', e));
                ws.addEventListener('close', e => {
                    console.log('[TropoForecast] WebSocket closed', e);
                    setTimeout(setupWebSocket, 5000);
                });
            } catch (err) {
                console.error('[TropoForecast] WebSocket setup failed', err);
                sendToast('error important', pluginName, 'WebSocket setup failed', false, false);
                setTimeout(setupWebSocket, 5000);
            }
        }
    }

    // ------------- Handle Incoming Messages ----------------
    function handleMessage(evt) {
        try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'GPS' && msg.value) {
                const { status, lat, lon, alt } = msg.value;
                
                // Update GPS data if active
                if (status === 'active' && lat && lon) {
                    gpsData.lat = lat;
                    gpsData.lon = lon;
                    gpsData.alt = alt || null;
                    gpsData.status = 'active';
                                    
                    // Update header coordinates
                    updateHeaderCoordinates();
                    
                    // Update map marker continuously
                    if (container && container.style.display !== 'none') {
                        if (!mapInstance || !positionMarker) {
                            // Create marker if it does not exist
                            if (mapInstance) {
                                drawPositionMarker(lat, lon);
                            }
                        } else {
                            // Update marker position if it exists
                            updateMapMarker();
                        }
                    }
                } else {
                    gpsData.status = 'inactive';
                }
            }
        } catch (e) {
            console.error('[TropoForecast] Error parsing message', e, evt.data);
        }
    }

    // ------------- Configuration -------------------
    const CONFIG = {
        apiGridRes: 12,
        renderRes: 1024,
        defaultRadius: 500,
        blurAmount: 'blur(1px)',
        opacity: 0.60 // SET TO 60% TRANSPARENCY
    };

    const PALETTE = [
        {color: 'rgba(0,0,0,0)', label: ''},
        {color: 'rgba(134,3,241,0.8)', label: 'Marginal'},
        {color: 'rgba(1,180,239,0.8)', label: 'Fair'},
        {color: 'rgba(2,208,131,0.9)', label: 'Moderate'},
        {color: 'rgba(165,235,1,0.9)', label: 'Good'},
        {color: 'rgba(239,222,5,0.9)', label: 'Very Good'},
        {color: 'rgba(233,177,12,1.0)', label: 'Excellent'},
        {color: 'rgba(255,128,0,1.0)', label: 'Intense'},
        {color: 'rgba(255,0,0,1.0)', label: 'Extreme'},
        {color: 'rgba(255,128,192,1.0)', label: 'Extreme+'},
        {color: 'rgba(255,180,220,1.0)', label: 'Max'}
    ];

    const QTH_LAT = localStorage.getItem('qthLatitude');
    const QTH_LON = localStorage.getItem('qthLongitude');

    let TropoMapActive = false;
    let container = null;
    let mapInstance = null;
    let weatherOverlayCanvas = null;
    let frames = [];
    let currentFrameIndex = 0;
    let isPlaying = false;
    let animationFrameId = null;
    let positionMarker = null;
    
    let apiBounds = null;
    let gridSize = CONFIG.apiGridRes;
    let lastSelectedRadius = localStorage.getItem('lastSelectedRadius') || CONFIG.defaultRadius;
    let hourUpdateInterval = null;
    let lastHourChecked = -1;

    function loadLeaflet(callback) {
        if (window.L) { callback(); return; }
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
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
        const e = calcVaporPressure(tempC, rh);
        return (77.6 / tempK) * (pressureHPa + 4810 * (e / tempK));
    }

    /**
     * Calculate wind shear magnitude between two pressure levels.
     * Wind shear (dV/dh) indicates mechanical turbulence or stable layer boundaries.
     * Strong shear at an inversion boundary supports and maintains ducting layers.
     *
     * @param {number} uLow  - U-component (m/s) at lower level
     * @param {number} vLow  - V-component (m/s) at lower level
     * @param {number} uUp   - U-component (m/s) at upper level
     * @param {number} vUp   - V-component (m/s) at upper level
     * @param {number} dh    - Height difference between levels (km)
     * @returns {number} Wind shear magnitude in (m/s)/km
     */
    function calcWindShear(uLow, vLow, uUp, vUp, dh) {
        const du = uUp - uLow;
        const dv = vUp - vLow;
        return Math.sqrt(du * du + dv * dv) / dh;
    }

    function calculateTropoIndexPrecise(hourly, idx) {
        const levels = [1000, 975, 950, 925, 900, 875, 850];
        const heights = { 1000: 0.11, 975: 0.32, 950: 0.54, 925: 0.76, 900: 0.99, 875: 1.22, 850: 1.46 };
        let maxGradientMag = 0;
        let shearAtMaxGradient = 0;

        for (let i = 0; i < levels.length - 1; i++) {
            const lowerP = levels[i];
            const upperP = levels[i+1];
            
            // Safety check for missing data
            if (!hourly[`temperature_${lowerP}hPa`] || !hourly[`temperature_${upperP}hPa`]) continue;

            const tLow = hourly[`temperature_${lowerP}hPa`][idx];
            const rhLow = hourly[`relative_humidity_${lowerP}hPa`][idx];
            const tUp = hourly[`temperature_${upperP}hPa`][idx];
            const rhUp = hourly[`relative_humidity_${upperP}hPa`][idx];

            if (tLow === undefined || tUp === undefined || rhLow === undefined || rhUp === undefined) continue;

            const nLow = calcN(tLow, rhLow, lowerP);
            const nUp = calcN(tUp, rhUp, upperP);
            const dh = heights[upperP] - heights[lowerP];
            const dn = nUp - nLow;
            const gradient = dn / dh;

            // Standard atmosphere gradient is approx. -39 N/km.
            // Only consider gradients significantly below normal as potential ducting.
            // -60 N/km filters out normal atmospheric variations and triggers
            // only when genuine superrefractive conditions begin to develop.
            if (gradient < -60) {
                if (Math.abs(gradient) > maxGradientMag) {
                    maxGradientMag = Math.abs(gradient);

                    // Calculate wind shear at this layer if wind data is available
                    const wsLow = hourly[`wind_speed_${lowerP}hPa`] ? hourly[`wind_speed_${lowerP}hPa`][idx] : undefined;
                    const wdLow = hourly[`wind_direction_${lowerP}hPa`] ? hourly[`wind_direction_${lowerP}hPa`][idx] : undefined;
                    const wsUp  = hourly[`wind_speed_${upperP}hPa`]  ? hourly[`wind_speed_${upperP}hPa`][idx]  : undefined;
                    const wdUp  = hourly[`wind_direction_${upperP}hPa`]  ? hourly[`wind_direction_${upperP}hPa`][idx]  : undefined;

                    if (wsLow !== undefined && wdLow !== undefined && wsUp !== undefined && wdUp !== undefined) {
                        // Convert wind speed + direction (meteorological) to u/v components
                        // Meteorological convention: direction is where wind comes FROM
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
        }

        // Minimum threshold: gradient must exceed 60 N/km magnitude
        // to register any tropo activity at all
        if (maxGradientMag < 60) return 0;

        // Base index from refractivity gradient (0-10 scale)
        // At 60 N/km = index 0 (just above threshold)
        // At 260 N/km = index 10 (extreme ducting)
        let index = (maxGradientMag - 60) / 20;

        // Wind shear enhancement factor:
        // Moderate shear (5-15 m/s/km) at a ducting layer indicates a stable, well-defined
        // inversion that supports and sustains tropospheric propagation.
        // Very high shear (>25 m/s/km) can break up the duct through turbulent mixing,
        // so the bonus tapers off at extreme shear values.
        //
        // Shear ranges and their contribution:
        //   0 -  5 m/s/km  : No bonus (calm, weak boundary)
        //   5 - 10 m/s/km  : Moderate bonus (up to +1.0) - duct forming
        //  10 - 20 m/s/km  : Strong bonus (up to +2.0) - well-maintained duct
        //  20 - 30 m/s/km  : Peak bonus (+2.0) then tapering - duct may start breaking
        //  30+  m/s/km     : Reduced bonus - excessive turbulence disrupts ducting
        if (shearAtMaxGradient > 5) {
            let shearBonus;
            if (shearAtMaxGradient <= 20) {
                // Linear ramp from 0 to +2.0 between 5 and 20 m/s/km
                shearBonus = ((shearAtMaxGradient - 5) / 15) * 2.0;
            } else if (shearAtMaxGradient <= 30) {
                // Taper from +2.0 down to +1.0 between 20 and 30 m/s/km
                shearBonus = 2.0 - ((shearAtMaxGradient - 20) / 10) * 1.0;
            } else {
                // Above 30 m/s/km: fixed small bonus, turbulence dominates
                shearBonus = 1.0;
            }
            index += shearBonus;
        }

        return Math.max(0, Math.min(10, index));
    }

    // --- RENDERING ---
    
    function interpolateGridValue(lat, lon, apiValues, bounds) {
        const u = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * (gridSize - 1);
        const v = (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat) * (gridSize - 1);

        const x0 = Math.floor(u);
        const x1 = Math.min(x0 + 1, gridSize - 1);
        const y0 = Math.floor(v);
        const y1 = Math.min(y0 + 1, gridSize - 1);

        if (x0 < 0 || x1 >= gridSize || y0 < 0 || y1 >= gridSize) return 0;

        const wx = u - x0;
        const wy = v - y0;

        const v00 = apiValues[y0 * gridSize + x0] || 0;
        const v10 = apiValues[y0 * gridSize + x1] || 0;
        const v01 = apiValues[y1 * gridSize + x0] || 0;
        const v11 = apiValues[y1 * gridSize + x1] || 0;

        const top = v00 * (1 - wx) + v10 * wx;
        const bottom = v01 * (1 - wx) + v11 * wx;
        return top * (1 - wy) + bottom * wy;
    }

    function renderDataToImage(apiValues, bounds) {
        const canvas = document.createElement('canvas');
        canvas.width = CONFIG.renderRes;
        canvas.height = CONFIG.renderRes;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(CONFIG.renderRes, CONFIG.renderRes);
        const data = imageData.data;

        for(let py = 0; py < CONFIG.renderRes; py++) {
            for(let px = 0; px < CONFIG.renderRes; px++) {
                const lat = bounds.maxLat - (py / CONFIG.renderRes) * (bounds.maxLat - bounds.minLat);
                const lon = bounds.minLon + (px / CONFIG.renderRes) * (bounds.maxLon - bounds.minLon);

                const val = interpolateGridValue(lat, lon, apiValues, bounds);

                if(val > 0.5) {
                    const colorIdx = Math.round(val);
                    const colorObj = PALETTE[Math.min(colorIdx, 10)];
                    
                    const idx = (py * CONFIG.renderRes + px) * 4;
                    const match = colorObj.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]*)\)/);
                    if(match) {
                        data[idx] = parseInt(match[1]);
                        data[idx + 1] = parseInt(match[2]);
                        data[idx + 2] = parseInt(match[3]);
                        data[idx + 3] = match[4] ? Math.round(parseFloat(match[4]) * 255) : 255;
                    }
                }
            }
        }
        ctx.putImageData(imageData, 0, 0);
        
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = CONFIG.renderRes;
        finalCanvas.height = CONFIG.renderRes;
        const fCtx = finalCanvas.getContext('2d');
        fCtx.filter = CONFIG.blurAmount;
        fCtx.drawImage(canvas, 0, 0);
        
        return finalCanvas;
    }

    function renderFrame(index) {
        if(!frames[index] || !mapInstance) return;
        
        if(index < 0) index = 0;
        if(index >= frames.length) index = frames.length - 1;
        
        currentFrameIndex = index;

        const t = frames[index].time;
        const dateEl = document.getElementById('tropo-date');
        const clockEl = document.getElementById('tropo-clock');
        const offsetEl = document.getElementById('tropo-offset');
        const timelineEl = document.getElementById('tropo-timeline');

        if(dateEl) dateEl.innerText = t.toUTCString().split(' ').slice(0, 4).join(' ');
        if(clockEl) {
            const utcHours = String(t.getUTCHours()).padStart(2, '0');
            const utcMinutes = String(t.getUTCMinutes()).padStart(2, '0');
            clockEl.innerHTML = `<span title="UTC Time">${utcHours}:${utcMinutes} UTC</span>`;
        }
        if(offsetEl) offsetEl.innerText = `(+${index}h)`;
        if(timelineEl) timelineEl.value = index;

        if (!frames[index].renderedImage) {
            frames[index].renderedImage = renderDataToImage(frames[index].visValues, apiBounds);
        }
        drawOnMap(frames[index].renderedImage);
    }

    function drawOnMap(imageCanvas) {
        if(!weatherOverlayCanvas || !mapInstance || !apiBounds) return;

        const ctx = weatherOverlayCanvas.getContext('2d');
        const size = mapInstance.getSize();
        
        if(weatherOverlayCanvas.width !== size.x || weatherOverlayCanvas.height !== size.y) {
            weatherOverlayCanvas.width = size.x;
            weatherOverlayCanvas.height = size.y;
        }
        ctx.clearRect(0, 0, size.x, size.y);
        
        const nw = L.latLng(apiBounds.maxLat, apiBounds.minLon);
        const se = L.latLng(apiBounds.minLat, apiBounds.maxLon);
        const nwPx = mapInstance.latLngToContainerPoint(nw);
        const sePx = mapInstance.latLngToContainerPoint(se);

        const width = sePx.x - nwPx.x;
        const height = sePx.y - nwPx.y;

        ctx.globalAlpha = CONFIG.opacity;
        ctx.drawImage(imageCanvas, nwPx.x, nwPx.y, width, height);
        ctx.globalAlpha = 1.0;
    }

    function animationLoop() {
        if (!isPlaying || frames.length === 0) {
            animationFrameId = null;
            return;
        }
        currentFrameIndex = (currentFrameIndex + 1) % frames.length;
        renderFrame(currentFrameIndex);
        animationFrameId = setTimeout(() => { animationLoop(); }, 1000);
    }

    function togglePlay() {
        isPlaying = !isPlaying;
        updatePlayButton();
        if (isPlaying) {
            if (!animationFrameId) animationLoop();
        } else {
            if (animationFrameId) { clearTimeout(animationFrameId); animationFrameId = null; }
        }
    }

    function updatePlayButton() {
        const btn = document.getElementById('tropo-play-btn');
        if (btn) {
            if (isPlaying) {
                btn.innerHTML = '❚❚';
                btn.title = 'Pause';
                btn.classList.add('color-4');
            } else {
                btn.innerHTML = '▶';
                btn.title = 'Play';
                btn.classList.remove('color-4');
            }
        }
    }

    // Update header coordinates in real-time
    function updateHeaderCoordinates() {
        const qthEl = document.getElementById('tropo-qth');
        if (qthEl) {
            if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
                qthEl.textContent = `${parseFloat(gpsData.lat).toFixed(5)}° / ${parseFloat(gpsData.lon).toFixed(5)}°`;
            } else if (QTH_LAT && QTH_LON) {
                qthEl.textContent = `${parseFloat(QTH_LAT).toFixed(5)}° / ${parseFloat(QTH_LON).toFixed(5)}°`;
            }
        }
    }

    // Update map marker position
    function updateMapMarker() {
        if (mapInstance && positionMarker && gpsData.lat && gpsData.lon) {
            const lat = parseFloat(gpsData.lat);
            const lon = parseFloat(gpsData.lon);
            
            if (!isNaN(lat) && !isNaN(lon)) {
                positionMarker.setLatLng([lat, lon]);
            }
        }
    }

    // Draw own position marker
    function drawPositionMarker(lat, lon) {
        if (positionMarker) {
            mapInstance.removeLayer(positionMarker);
        }

        const lat_num = parseFloat(lat);
        const lon_num = parseFloat(lon);

        positionMarker = L.circleMarker([lat_num, lon_num], {
            radius: 5,
            fillColor: '#FF0000',
            color: '#FF0000',
            weight: 0,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(mapInstance);

        positionMarker.bindPopup(`📍 Position<br>${lat_num.toFixed(5)}° / ${lon_num.toFixed(5)}°`);
    }

    // Get last full hour in UTC
    function getLastFullHour() {
        const now = new Date();
        const utcHour = now.getUTCHours();
        return utcHour;
    }

    // Check if hour has changed and reload data
    function checkHourChange() {
        if (!TropoMapActive || !container || container.style.display === 'none') {
            return;
        }

        const currentHour = getLastFullHour();
        
        if (currentHour !== lastHourChecked) {
            console.log(`[TropoForecast] Hour changed from ${lastHourChecked} to ${currentHour}. Reloading data...`);
            lastHourChecked = currentHour;
            loadDataForRadius(parseInt(lastSelectedRadius));
        }
    }

    // Helper: Calculate Bounds
    function calculateBounds(lat, lon, radiusKm) {
        const latDeg = radiusKm / 111.0;
        const lonDeg = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));
        return {
            minLat: lat - latDeg,
            maxLat: lat + latDeg,
            minLon: lon - lonDeg,
            maxLon: lon + lonDeg
        };
    }

    // Helper: Fetch and cache logic
    async function fetchAndCacheTropoData(centerLat, centerLon, radiusKm) {
        // Calculate bounds based on selected radius
        const bounds = calculateBounds(centerLat, centerLon, radiusKm);
        
        // Create cache key based on center coordinates and radius + VERSION
        const cacheKey = `tropo_v${CACHE_VERSION}_${Math.round(centerLat * 100)}_${Math.round(centerLon * 100)}_${radiusKm}`;
        const cachedData = localStorage.getItem(cacheKey);
        
        if (cachedData) {
            try {
                // Use cached data
                const cached = JSON.parse(cachedData);
                
                // Check if cache is still valid (less than 1 hour old)
                const cacheAge = Date.now() - cached.timestamp;
                if (cacheAge < 3600000) { // 1 hour
                    console.log('[TropoForecast] Using cached data');
                    return { results: cached.results, bounds };
                }
                console.log('[TropoForecast] Cache expired, fetching fresh data');
            } catch(e) {
                console.warn("[TropoForecast] Invalid cache, fetching fresh.");
            }
        }

        // Fetch new data
        console.log('[TropoForecast] Fetching fresh data from API');
        
        const apiLats = [];
        const apiLons = [];
        const gSize = CONFIG.apiGridRes;

        // Generate grid points
        for(let y = 0; y < gSize; y++) {
            const lat = bounds.minLat + (y / (gSize-1)) * (bounds.maxLat - bounds.minLat);
            for(let x = 0; x < gSize; x++) {
                const lon = bounds.minLon + (x / (gSize-1)) * (bounds.maxLon - bounds.minLon);
                apiLats.push(lat.toFixed(2));
                apiLons.push(lon.toFixed(2));
            }
        }

        console.log('[TropoForecast] Requesting', apiLats.length, 'grid points');
        
        const levels = [1000, 975, 950, 925, 900, 875, 850];
        let params = [];
        levels.forEach(l => {
            params.push(`temperature_${l}hPa`);
            params.push(`relative_humidity_${l}hPa`);
            // Wind data for shear calculation
            params.push(`wind_speed_${l}hPa`);
            params.push(`wind_direction_${l}hPa`);
        });
        
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${apiLats.join(',')}&longitude=${apiLons.join(',')}&hourly=${params.join(',')}&forecast_days=2&models=best_match`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`API Error: ${resp.status}`);
        const json = await resp.json();

        let results = [];
        // The API returns an array for multiple locations, or a single object for one location
        if(json.hourly) {
            results = [json];
        } else if(Array.isArray(json)) {
            results = json;
        } else {
            console.error('[TropoForecast] Unexpected API response:', json);
            throw new Error("Invalid API response format");
        }

        console.log('[TropoForecast] Parsed', results.length, 'result objects');

        // Cache the data with error handling for QuotaExceededError
        try {
            const cachePayload = JSON.stringify({
                results: results,
                timestamp: Date.now()
            });

            try {
                localStorage.setItem(cacheKey, cachePayload);
                console.log('[TropoForecast] Data cached successfully');
            } catch (e) {
                if (e.name === 'QuotaExceededError' || e.code === 22) {
                    console.warn('[TropoForecast] Storage quota exceeded. Clearing old cache...');
                    
                    // Clear all Tropo related items to free up space
                    Object.keys(localStorage)
                        .filter(key => key.startsWith('tropo_'))
                        .forEach(key => localStorage.removeItem(key));
                    
                    // Try again
                    localStorage.setItem(cacheKey, cachePayload);
                    console.log('[TropoForecast] Data cached after cleanup');
                } else {
                    throw e;
                }
            }
        } catch (e) {
            console.error('[TropoForecast] Could not cache data (proceeding without cache):', e);
        }
        
        return { results, bounds };
    }

    // Startup background fetch
    function initBackgroundCache() {
        const r = parseInt(localStorage.getItem('lastSelectedRadius') || CONFIG.defaultRadius);
        
        let targetLat, targetLon;

        // Use QTH if available
        if(QTH_LAT && QTH_LON) {
             targetLat = parseFloat(QTH_LAT);
             targetLon = parseFloat(QTH_LON);
             console.log(`[TropoForecast] Prefetching data for QTH: ${targetLat}, ${targetLon}`);
             fetchAndCacheTropoData(targetLat, targetLon, r).catch(e => console.log("[TropoForecast] Background fetch failed:", e));
        } 
        // Fallback to Geolocation
        else if ("geolocation" in navigator) {
             navigator.geolocation.getCurrentPosition(p => {
                  targetLat = p.coords.latitude;
                  targetLon = p.coords.longitude;
                  console.log(`[TropoForecast] Prefetching data for Geo: ${targetLat}, ${targetLon}`);
                  fetchAndCacheTropoData(targetLat, targetLon, r).catch(e => console.log("[TropoForecast] Background fetch failed:", e));
             });
        }
    }

    async function loadDataForRadius(radiusKm) {
        if(!mapInstance) return;

        // 1. Update UI state
        localStorage.setItem('lastSelectedRadius', radiusKm);
        lastSelectedRadius = radiusKm;

        document.querySelectorAll('.radius-btn').forEach(b => {
            b.classList.remove('color-4');
        });
        
        const activeBtn = document.getElementById(`btn-${radiusKm}`);
        if(activeBtn) {
            activeBtn.classList.add('color-4');
        }

        const statusEl = document.getElementById('tropo-status-overlay');
        if(statusEl) {
            statusEl.innerHTML = `<span class="spin">⟳</span> Loading data...`;
            statusEl.style.display = 'block';
        }

        // 2. Stop any running animation
        const wasPlaying = isPlaying;
        if (animationFrameId) { clearTimeout(animationFrameId); animationFrameId = null; }
        isPlaying = false; 

        // 3. Determine Center
         let center;
        if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
            center = { lat: parseFloat(gpsData.lat), lng: parseFloat(gpsData.lon) };
        } else if (QTH_LAT && QTH_LON) {
            center = { lat: parseFloat(QTH_LAT), lng: parseFloat(QTH_LON) };
        } else {
            center = mapInstance.getCenter();
        }
        
        // Update marker if needed
        if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
            drawPositionMarker(gpsData.lat, gpsData.lon);
        } else if (QTH_LAT && QTH_LON) {
            drawPositionMarker(QTH_LAT, QTH_LON);
        }
        
        centerPoint = [center.lat, center.lng];

        try {
            // 4. Fetch Data FIRST (keep the old view visible while loading)
            if(statusEl) statusEl.innerHTML = `<span class="spin">⟳</span> Fetching data...`;
            
            // This waits for the data to be ready...
            const data = await fetchAndCacheTropoData(center.lat, center.lng, radiusKm);
            const results = data.results;
            
            // 5. NOW update the map view (Instant switch, no animation)
            
            // Clear the old overlay explicitly to avoid artifacts
            if(weatherOverlayCanvas) {
                const ctx = weatherOverlayCanvas.getContext('2d');
                ctx.clearRect(0, 0, weatherOverlayCanvas.width, weatherOverlayCanvas.height);
            }

            apiBounds = data.bounds;
            const viewBounds = L.latLngBounds(
                [apiBounds.minLat, apiBounds.minLon],
                [apiBounds.maxLat, apiBounds.maxLon]
            );

            // IMPORTANT: animate: false prevents the "fade/zoom" glitch
            mapInstance.fitBounds(viewBounds, { padding: [0, 0], animate: false });
            mapInstance.invalidateSize();

            // 6. Process Frames
            frames = [];
            const nowHour = getLastFullHour();
            lastHourChecked = nowHour;
            const maxLen = results[0] && results[0].hourly && results[0].hourly.time ? results[0].hourly.time.length : 0;

            console.log('[TropoForecast] Processing frames starting from hour index:', nowHour);

            for(let h=0; h<24; h++) {
                const hourIdx = nowHour + h;
                if(hourIdx >= maxLen) break;
                
                const timeStr = results[0].hourly.time[hourIdx];
                const timeDate = new Date(timeStr + 'Z');
                
                const visValues = new Float32Array(results.length);
                
                for(let i = 0; i < results.length; i++) {
                    if (results[i] && results[i].hourly) {
                        const index = calculateTropoIndexPrecise(results[i].hourly, hourIdx);
                        visValues[i] = index;
                    }
                }
                
                frames.push({
                    time: timeDate,
                    visValues: visValues,
                    renderedImage: null
                });
            }

            console.log('[TropoForecast] Created', frames.length, 'frames total');

            const slider = document.getElementById('tropo-timeline');
            if(slider && frames.length > 0) {
                slider.max = frames.length - 1;
                if (currentFrameIndex >= frames.length) currentFrameIndex = 0;
                slider.value = currentFrameIndex;
            }
            
            if(statusEl) statusEl.style.display = 'none';
            
            if(frames.length > 0) {
                // Synchronously draw the first frame
                renderFrame(currentFrameIndex);

                if(wasPlaying) {
                    isPlaying = true;
                    animationLoop();
                } else {
                    updatePlayButton();
                }
            } else {
                if(statusEl) {
                    statusEl.innerText = "No data!";
                    statusEl.style.display = 'block';
                }
            }

        } catch(e) {
            console.error('[TropoForecast] Error:', e);
            if(statusEl) {
                statusEl.innerText = '⚠️ Error: ' + e.message;
                setTimeout(() => { statusEl.style.display='none'; }, 5000);
            }
        }
    }

    // --- Drag & Drop Functionality ---
    function makeDraggable(el) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = document.getElementById("tropo-header");
        
        if (header) {
            header.onmousedown = dragMouseDown;
        } else {
            el.onmousedown = dragMouseDown;
        }

        function dragMouseDown(e) {
            e = e || window.event;
            // Only drag if left mouse button
            if(e.button !== 0) return;
            
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            // Calculate new positions
            let newTop = (el.offsetTop - pos2);
            let newLeft = (el.offsetLeft - pos1);
            
            // Set position
            el.style.top = newTop + "px";
            el.style.left = newLeft + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            
            // Save to localStorage
            localStorage.setItem('tropoTop', el.style.top);
            localStorage.setItem('tropoLeft', el.style.left);
        }
    }

    function createUI() {
        if(container) return;

        let qthDisplay = '--';
        if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
            qthDisplay = `${parseFloat(gpsData.lat).toFixed(5)}° / ${parseFloat(gpsData.lon).toFixed(5)}°`;
        } else if (QTH_LAT && QTH_LON) {
            qthDisplay = `${parseFloat(QTH_LAT).toFixed(5)}° / ${parseFloat(QTH_LON).toFixed(5)}°`;
        }

        const style = document.createElement('style');
        style.innerHTML = `
            #tropo-overlay { 
                position:fixed; 
                display:none; 
                width: 440px;
                background-color: var(--color-1); 
                color:#fff;
                font-family: sans-serif; 
                border-radius:8px;
                z-index:9999; 
                cursor:move; 
                user-select:none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                border: 1px solid #444; 
                font-size: 13px;
                overflow: hidden;
                isolation: isolate;
            }
            #tropo-header {
                background-color: var(--color-1);
                padding: 8px 15px;
                border-bottom: 1px solid #444; 
                font-weight: bold;
                border-radius: 8px 8px 0 0; 
                display:flex; 
                justify-content:space-between; 
                align-items:center;
                cursor:move;
                position: relative;
                gap: 8px;
                z-index: 10000;
            }
            #tropo-title {
                color: white;
                flex: 1;
            }
            #tropo-qth {
                position: absolute;
                left: 50%;
                transform: translateX(-50%) translateY(10%);
                font-size: 12px;
                color: var(--color-4);
                white-space: nowrap;
                width: auto;
                max-width: 140px;
                pointer-events: none;
            }
            #tropo-close {
                cursor: pointer; 
                font-weight: bold; 
                color: #ccc; 
                font-size: 18px; 
                line-height: 1; 
                padding: 0 4px;
                margin-right: -10px;
                flex-shrink: 0;
            }
            #tropo-close:hover { 
                color: #fff; 
            }
            
            #tropo-map-container {
                position: relative;
                z-index: 1;
            }
            #tropo-map-container .leaflet-pane {
                z-index: auto;
            }
            #tropo-map-container .leaflet-top,
            #tropo-map-container .leaflet-bottom {
                z-index: 2;
            }
            
            #tropo-content {
                padding: 12px; 
                background:#0a0a0a; 
                border-top:1px solid #222; 
                max-height: 500px; 
                overflow-y: auto;
                position: relative;
                z-index: 10000;
            }
            
            input[type=range].tropo-slider { -webkit-appearance: none; width: 100%; background: transparent; margin: 0; }
            input[type=range].tropo-slider:focus { outline: none; }
            input[type=range].tropo-slider::-webkit-slider-thumb {
                -webkit-appearance: none; height: 14px; width: 14px; border-radius: 50%;
                background: #fff; box-shadow: 0 0 5px rgba(0,0,0,0.5); cursor: pointer; margin-top: -5px;
            }
            input[type=range].tropo-slider::-webkit-slider-runnable-track {
                width: 100%; height: 4px; cursor: pointer; background: rgba(255,255,255,0.3); border-radius: 2px;
            }
            @keyframes spin { 100% { transform: rotate(360deg); } }
            .spin { display: inline-block; animation: spin 1s infinite linear; }
            
            .radius-btn { 
                background: transparent; 
                border: 1px solid #444; 
                color: #fff; 
                padding: 4px 8px; 
                font-size: 11px; 
                cursor: pointer; 
                border-radius: 4px; 
                transition: all 0.2s; 
                min-width: 45px; 
                text-align: center; 
            }
            .radius-btn:hover { 
                border-color: #fff; 
            }
            .radius-btn.color-4 {
                background-color: var(--color-4);
                color: #000;
                border-color: var(--color-4);
                font-weight: bold;
            }
            
            .play-btn { 
                background: transparent; 
                border: 1px solid #444; 
                color: #fff; 
                font-size: 11px; 
                cursor: pointer; 
                border-radius: 4px; 
                transition: all 0.2s; 
                width: 28px; 
                height: 28px; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                padding: 0; 
                flex-shrink: 0; 
            }
            .play-btn:hover { 
                border-color: #fff; 
            }
            .play-btn.color-4 {
                background-color: var(--color-4);
                color: #000;
                border-color: var(--color-4);
                font-weight: bold;
            }
            
            .legend-item { display: flex; flex-direction: column; align-items: center; width: 100%; }
            .legend-color { width: 100%; height: 10px; margin-bottom: 2px; }
            .legend-label { font-size: 9px; color: #aaa; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            
            #tropo-map-container { height: 100%; }
            
            #tropo-validation-badge {
                font-size: 8px;
                color: #666;
                text-align: center;
                padding-top: 8px;
                border-top: 1px solid #333;
                cursor: help;
            }
        `;
        document.head.appendChild(style);

        container = document.createElement('div');
        container.id = 'tropo-overlay';
        
        // Retrieve and validate localStorage positions
        let savedTop = localStorage.getItem('tropoTop') || '20px';
        let savedLeft = localStorage.getItem('tropoLeft') || '20px';
        
        // Safety check: if position is crazy (off screen), reset it
        if (parseInt(savedTop) < 0 || parseInt(savedTop) > window.innerHeight - 50) savedTop = '20px';
        if (parseInt(savedLeft) < 0 || parseInt(savedLeft) > window.innerWidth - 50) savedLeft = '20px';
        
        container.style.cssText = `
            position:fixed; 
            top:${savedTop}; 
            left:${savedLeft}; 
            width:440px; 
            height:625px; 
            display:none; 
            flex-direction:column; 
            background: var(--color-1);
            z-index: 9999;
            isolation: isolate;
        `;

        const header = document.createElement('div');
        header.id = 'tropo-header';
        header.innerHTML = `
            <span id="tropo-title">Tropo Forecast</span>
            <span id="tropo-qth">${qthDisplay}</span>
            <span id="tropo-close" title="Close">&times;</span>
        `;
        container.appendChild(header);

        const mapDiv = document.createElement('div');
        mapDiv.id = 'tropo-map-container';
        mapDiv.style.cssText = "flex:1; position:relative; background:#000;";
        container.appendChild(mapDiv);

        const statusOverlay = document.createElement('div');
        statusOverlay.id = 'tropo-status-overlay';
        statusOverlay.style.cssText = "position:absolute; top:50px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); padding:8px 20px; border-radius:20px; color:white; font-size:13px; z-index:10001; display:none; border:1px solid #444; pointer-events:none;";
        mapDiv.appendChild(statusOverlay);

        const controls = document.createElement('div');
        controls.id = 'tropo-content';
        
        const topControls = document.createElement('div');
        topControls.style.cssText = "display:flex; align-items:center; margin-bottom:10px; gap:8px;";
        topControls.innerHTML = `
            <button id="tropo-play-btn" class="play-btn" title="Play">▶</button>
            <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#aaa; margin-bottom:-6px;">
                    <span id="tropo-date">--</span>
                    <span style="color:white; font-weight:bold;" id="tropo-clock" title="UTC Time">--:-- UTC</span>
                    <span id="tropo-offset" style="color:var(--color-4);">(+0h)</span>
                </div>
                <input type="range" id="tropo-timeline" class="tropo-slider" min="0" max="23" value="0">
            </div>
        `;
        controls.appendChild(topControls);

        const radiusControls = document.createElement('div');
        radiusControls.style.cssText = "display:flex; gap:5px; margin-bottom:10px;";
        radiusControls.innerHTML = `
            <button class="radius-btn" id="btn-200">200km</button>
            <button class="radius-btn" id="btn-300">300km</button>
            <button class="radius-btn" id="btn-400">400km</button>
            <button class="radius-btn" id="btn-500">500km</button>
        `;
        controls.appendChild(radiusControls);

        const legend = document.createElement('div');
        legend.style.cssText = "display:flex; gap:1px; margin-top:5px; background:#000; padding:5px; border-radius:4px;";
        
        let legendHTML = '';
        for(let i=1; i<PALETTE.length; i++) {
            legendHTML += `
                <div class="legend-item">
                    <div class="legend-color" style="background:${PALETTE[i].color};"></div>
                    <div class="legend-label">${PALETTE[i].label}</div>
                </div>
            `;
        }
        legend.innerHTML = legendHTML;
        controls.appendChild(legend);

        const validationBadge = document.createElement('div');
        validationBadge.id = 'tropo-validation-badge';
        validationBadge.title = 'ITU-R P.453 validated calculation';
        validationBadge.innerHTML = '✓ Validated | 12×12 Grid';
        controls.appendChild(validationBadge);

        container.appendChild(controls);
        document.body.appendChild(container);
        
        // Enable dragging
        makeDraggable(container);

        mapInstance = L.map('tropo-map-container', { 
            center: [51.29, 12.44], 
            zoom: 7,
            zoomControl: false,
            attributionControl: false,
            zoomSnap: 0,
            scrollWheelZoom: false,
            dragging: false,      
            touchZoom: false,  
            doubleClickZoom: false 
        });

        // CartoDB.DarkMatterNoLabels
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(mapInstance);

        L.CanvasOverlay = L.Layer.extend({
            onAdd: function(map) {
                this._map = map;
                this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer');
                this._canvas.style.pointerEvents = 'none';
                var size = this._map.getSize();
                this._canvas.width = size.x;
                this._canvas.height = size.y;
                var animated = this._map.options.zoomAnimation && L.Browser.any3d;
                L.DomUtil.addClass(this._canvas, 'leaflet-zoom-' + (animated ? 'animated' : 'hide'));
                map._panes.overlayPane.appendChild(this._canvas);
                map.on('moveend', this._reset, this);
                map.on('resize', this._resize, this);
                weatherOverlayCanvas = this._canvas;
            },
            onRemove: function(map) {
                map.getPanes().overlayPane.removeChild(this._canvas);
                map.off('moveend', this._reset, this);
                map.off('resize', this._resize, this);
            },
            _reset: function() {
                var topLeft = this._map.containerPointToLayerPoint([0, 0]);
                L.DomUtil.setPosition(this._canvas, topLeft);
                this._redraw();
            },
            _resize: function(e) {
                var size = e.newSize;
                this._canvas.width = size.x;
                this._canvas.height = size.y;
                this._reset();
            },
            _redraw: function() {
                if(frames[currentFrameIndex] && frames[currentFrameIndex].renderedImage) {
                    drawOnMap(frames[currentFrameIndex].renderedImage);
                }
            }
        });

        mapInstance.addLayer(new L.CanvasOverlay());

        document.addEventListener('keydown', (e) => {
            if (e.key === '+' || e.key === '-' || e.key === '=' || e.code === 'Equal' || e.code === 'Minus') {
                if (TropoMapActive) {
                    e.preventDefault();
                }
            }
        }, true);

        // Define starting point but do NOT automatically call loadDataForRadius here anymore
        // It will be called by togglePlugin() so we can wait for it.
        const setStartCenter = (lat, lon) => {
             mapInstance.setView([lat, lon], 7);
        };

        if (gpsData.status === 'active' && gpsData.lat && gpsData.lon) {
            setStartCenter(parseFloat(gpsData.lat), parseFloat(gpsData.lon));
        } else if (QTH_LAT && QTH_LON) {
            setStartCenter(parseFloat(QTH_LAT), parseFloat(QTH_LON));
        } else if ("geolocation" in navigator) {
             navigator.geolocation.getCurrentPosition(p => {
                 setStartCenter(p.coords.latitude, p.coords.longitude);
             }, () => {
                 setStartCenter(51.29, 12.44);
             });
        } else {
            setStartCenter(51.29, 12.44);
        }

        document.getElementById('tropo-close').addEventListener('click', () => {
            const btn = document.getElementById('TROPO-BTN');
            if (btn) btn.click(); // Trigger the standard toggle off function
        });

        document.getElementById('tropo-play-btn').addEventListener('click', togglePlay);
        document.getElementById('tropo-timeline').addEventListener('input', (e) => {
            isPlaying = false;
            if (animationFrameId) {
                clearTimeout(animationFrameId);
                animationFrameId = null;
            }
            updatePlayButton();
            renderFrame(parseInt(e.target.value));
        });

        [200, 300, 400, 500].forEach(km => {
            document.getElementById(`btn-${km}`).addEventListener('click', () => loadDataForRadius(km));
        });
    }

    function togglePlugin() {
        TropoMapActive = !TropoMapActive;
        const btn = document.getElementById('TROPO-BTN');
        
        if(TropoMapActive) {
            loadLeaflet(() => {
                createUI();
                if(btn) btn.classList.add('active');
                
                const $overlay = $('#tropo-overlay');
                
                // Show the container in the DOM with 0 opacity so Leaflet can get the correct dimensions
                $overlay.css({
                    'display': 'flex',
                    'opacity': 0
                });
                
                setTimeout(async () => {
                    if(mapInstance) {
                        mapInstance.invalidateSize();
                        // WAIT for data to be loaded and the first frame to be drawn onto the canvas
                        await loadDataForRadius(parseInt(lastSelectedRadius));
                        // Fade EVERYTHING in together smoothly
                        $overlay.animate({ opacity: 1 }, 600);
                    }
                }, 100);

                // Start hour change checker
                lastHourChecked = getLastFullHour();
                if (hourUpdateInterval) clearInterval(hourUpdateInterval);
                hourUpdateInterval = setInterval(checkHourChange, 60000); // Check every minute
            });
        } else {
            if(btn) btn.classList.remove('active');
            
            // Fade EVERYTHING out together
            $('#tropo-overlay').animate({ opacity: 0 }, 600, function() {
                $(this).css('display', 'none');
                
                // Clear tropo clouds ONLY AFTER the window is completely invisible
                if (weatherOverlayCanvas) {
                    const ctx = weatherOverlayCanvas.getContext('2d');
                    ctx.clearRect(0, 0, weatherOverlayCanvas.width, weatherOverlayCanvas.height);
                }
                frames = [];
                currentFrameIndex = 0;
            });
            
            isPlaying = false;
            if (animationFrameId) {
                clearTimeout(animationFrameId);
                animationFrameId = null;
            }

            // Stop hour change checker
            if (hourUpdateInterval) {
                clearInterval(hourUpdateInterval);
                hourUpdateInterval = null;
            }
        }
    }

    // --- Toolbar Button ---
    (function () {
        const btnId = 'TROPO-BTN';
        let found = false;
        const obs = new MutationObserver((_, o) => {
            if (typeof addIconToPluginPanel === 'function') {
                found = true; 
                o.disconnect();
                addIconToPluginPanel(btnId, 'Tropo', 'solid', 'mountain', `Plugin Version: ${pluginVersion}`);
                
                const btnObs = new MutationObserver((_, o2) => {
                    const $btn = $(`#${btnId}`);
                    $btn.addClass("hide-phone bg-color-2");
                    if ($btn.length) {
                        o2.disconnect();
                        const css = `
                            #${btnId}:hover { color: var(--color-5); filter: brightness(120%); }
                            #${btnId}.active { background-color: var(--color-2)!important; filter: brightness(120%); }
                        `;
                        $("<style>").prop("type", "text/css").html(css).appendTo("head");
                        
                        $btn.on('click', togglePlugin);
                    }
                });
                btnObs.observe(document.body, { childList: true, subtree: true });
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { if (!found) obs.disconnect(); }, 10000);
    })();

    // --- Admin Check & Initialization ----------------
    function checkAdmin() {
        const text = document.body.textContent || document.body.innerText;
        isAuth = text.includes('You are logged in as an administrator.')
            || text.includes('You are logged in as an adminstrator.');
        console.log(isAuth ? '[TropoForecast] Admin authentication OK' : '[TropoForecast] Admin authentication failed');
    }

    setupWebSocket();
    checkAdmin();
    
    // Start background prefetching
    initBackgroundCache();

})();