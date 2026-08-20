    /////////////////////////////////////////////////////////////////////
    ///                                                               ///
    ///  TROPO FORECAST (SERVER MODUL) FOR FM-DX-WEBSERVER      V2.0b ///
    ///                                                               ///
    ///  by Highpoint                        last update: 2026-08-20  ///
    ///                                                               ///
	///  Revised by AmateurAudioDude                                  ///
    ///                                                               ///
    ///  https://github.com/Highpoint2000/TropoForecast               ///
    ///                                                               ///
    /////////////////////////////////////////////////////////////////////

'use strict';

const WebSocket = require('ws');
const https = require('https');
const config = require('./../../config.json');
const { logInfo, logError } = require('../../server/console');

const PLUGIN_NAME = 'TropoForecast';
const GRID_CACHE_TTL_MS = 3 * 60 * 60 * 1000;  // 3 hours – large payload, cheap to reuse
const POINT_CACHE_TTL_MS = 60 * 60 * 1000;     // 1 hour  – forecast_hours=1 goes stale fast
const INFLIGHT_TIMEOUT_MS = 60 * 1000;         // safety cleanup
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const GRID_RES = 12;
const FORECAST_HOURS = 48;
const LEVELS = [1000, 975, 950, 925, 900, 875, 850];

const webserverPort = config.webserver.webserverPort || 8080;
const externalWsUrl = `ws://127.0.0.1:${webserverPort}`;
let dataPluginsSocket = null;

const gridCache = new Map();    // key -> { data, expiresAt }
const pointCache = new Map();
const gridInflight = new Map(); // key -> { ids: Set, startedAt }
const pointInflight = new Map();

function roundKey(lat, lon, radius) {
    const rl = Math.round(parseFloat(lat) * 100) / 100;
    const rn = Math.round(parseFloat(lon) * 100) / 100;
    return radius != null ? `${rl}_${rn}_${radius}` : `${rl}_${rn}`;
}

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

function buildHourlyParams() {
    const params = [];
    LEVELS.forEach(l => {
        params.push(`temperature_${l}hPa`);
        params.push(`relative_humidity_${l}hPa`);
        params.push(`wind_speed_${l}hPa`);
        params.push(`wind_direction_${l}hPa`);
    });
    return params.join(',');
}

function httpGetJson(url, label = 'API') {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`API ${res.statusCode}`));
                res.resume();
                return;
            }
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                logInfo(`[${PLUGIN_NAME}] ${label} fetch: ${(raw.length / 1024).toFixed(1)} KB received`);
                try { resolve(JSON.parse(raw)); }
                catch (e) { reject(new Error('invalid JSON from API')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(new Error('API timeout')); });
    });
}

async function fetchGrid(lat, lon, radiusKm) {
    const bounds = calculateBounds(lat, lon, radiusKm);
    const lats = [];
    const lons = [];
    for (let y = 0; y < GRID_RES; y++) {
        const rowLat = bounds.minLat + (y / (GRID_RES - 1)) * (bounds.maxLat - bounds.minLat);
        for (let x = 0; x < GRID_RES; x++) {
            const colLon = bounds.minLon + (x / (GRID_RES - 1)) * (bounds.maxLon - bounds.minLon);
            lats.push(rowLat.toFixed(2));
            lons.push(colLon.toFixed(2));
        }
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${buildHourlyParams()}&forecast_hours=${FORECAST_HOURS}&models=icon_eu`;
    const json = await httpGetJson(url, 'grid');
    let results = [];
    if (json.hourly) results = [json];
    else if (Array.isArray(json)) results = json;
    else throw new Error('invalid grid response');

    // Separate minimal request with timezone=auto to get the local timezone name
    const tzUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto&hourly=temperature_2m&forecast_hours=1&models=best_match`;
    const tzJson = await httpGetJson(tzUrl, 'timezone').catch(() => null);
    const locationName = tzJson ? parseLocationName(tzJson.timezone) : null;

    const { time, grid } = buildIndexGrid(results);
    return { time, grid, bounds, locationName };
}

// --- PHYSICS ENGINE (mirrors the tropo-index formula, run once here instead of once per client) ---
const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 875, 850];
const LEVEL_HEIGHTS = { 1000: 0.11, 975: 0.32, 950: 0.54, 925: 0.76, 900: 0.99, 875: 1.22, 850: 1.46 };

function calcVaporPressure(tempC, rh) {
    const es = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
    return es * (rh / 100.0);
}

function calcN(tempC, rh, pressureHPa) {
    const tempK = tempC + 273.15;
    const e = calcVaporPressure(tempC, rh);
    return (77.6 / tempK) * (pressureHPa + 4810 * (e / tempK));
}

function calcWindShear(uLow, vLow, uUp, vUp, dh) {
    const du = uUp - uLow;
    const dv = vUp - vLow;
    return Math.sqrt(du * du + dv * dv) / dh;
}

function calculateTropoIndexPrecise(hourly, idx) {
    let maxGradientMag = 0;
    let shearAtMaxGradient = 0;

    const availableLevels = PRESSURE_LEVELS.filter(p => 
        hourly[`temperature_${p}hPa`] && hourly[`temperature_${p}hPa`][idx] != null
    );

    for (let i = 0; i < availableLevels.length - 1; i++) {
        const lowerP = availableLevels[i];
        const upperP = availableLevels[i + 1];

        const tLow = hourly[`temperature_${lowerP}hPa`][idx];
        const rhLow = hourly[`relative_humidity_${lowerP}hPa`][idx];
        const tUp = hourly[`temperature_${upperP}hPa`][idx];
        const rhUp = hourly[`relative_humidity_${upperP}hPa`][idx];

        const nLow = calcN(tLow, rhLow, lowerP);
        const nUp = calcN(tUp, rhUp, upperP);
        const dh = LEVEL_HEIGHTS[upperP] - LEVEL_HEIGHTS[lowerP];
        const gradient = (nUp - nLow) / dh;

        if (gradient < -60 && Math.abs(gradient) > maxGradientMag) {
            maxGradientMag = Math.abs(gradient);

            const wsLow = hourly[`wind_speed_${lowerP}hPa`] ? hourly[`wind_speed_${lowerP}hPa`][idx] : undefined;
            const wdLow = hourly[`wind_direction_${lowerP}hPa`] ? hourly[`wind_direction_${lowerP}hPa`][idx] : undefined;
            const wsUp = hourly[`wind_speed_${upperP}hPa`] ? hourly[`wind_speed_${upperP}hPa`][idx] : undefined;
            const wdUp = hourly[`wind_direction_${upperP}hPa`] ? hourly[`wind_direction_${upperP}hPa`][idx] : undefined;

            if (wsLow !== undefined && wdLow !== undefined && wsUp !== undefined && wdUp !== undefined) {
                const wdLowRad = (wdLow * Math.PI) / 180;
                const wdUpRad = (wdUp * Math.PI) / 180;
                const uLow = -wsLow * Math.sin(wdLowRad);
                const vLow = -wsLow * Math.cos(wdLowRad);
                const uUp = -wsUp * Math.sin(wdUpRad);
                const vUp = -wsUp * Math.cos(wdUpRad);
                shearAtMaxGradient = calcWindShear(uLow, vLow, uUp, vUp, dh);
            }
        }
    }

    if (maxGradientMag < 60) return 0;
    let index = (maxGradientMag - 60) / 20;

    if (shearAtMaxGradient > 5) {
        let shearBonus;
        if (shearAtMaxGradient <= 20) shearBonus = ((shearAtMaxGradient - 5) / 15) * 2.0;
        else if (shearAtMaxGradient <= 30) shearBonus = 2.0 - ((shearAtMaxGradient - 20) / 10) * 1.0;
        else shearBonus = 1.0;
        index += shearBonus;
    }
    return Math.max(0, Math.min(10, index));
}

// Reduce the 144-points x N-hours x 28-variables raw API response down to
// just the derived index per point/hour, before it ever hits the wire.
function buildIndexGrid(results) {
    const timeArray = (results[0] && results[0].hourly) ? results[0].hourly.time : [];
    const hours = timeArray.length;
    const grid = new Array(hours);
    for (let h = 0; h < hours; h++) {
        const row = new Array(results.length);
        for (let i = 0; i < results.length; i++) {
            row[i] = (results[i] && results[i].hourly) ? Math.round(calculateTropoIndexPrecise(results[i].hourly, h) * 100) / 100 : 0;
        }
        grid[h] = row;
    }
    return { time: timeArray, grid };
}

function parseLocationName(timezone) {
    if (!timezone || timezone === 'GMT' || timezone === 'UTC') return null;
    const parts = timezone.split('/');
    if (parts.length < 2) return null;
    // Format tz database
    const city = parts[parts.length - 1].replace(/_/g, ' ');
    const region = parts[0].replace(/_/g, ' ');
    return `${city}, ${region}`;
}

async function fetchPoint(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${buildHourlyParams()}&forecast_hours=1&models=icon_eu`;
    return await httpGetJson(url, 'point');
}

function getCached(cache, key) {
    const v = cache.get(key);
    if (!v) return null;
    if (v.expiresAt < Date.now()) { cache.delete(key); return null; }
    return v.data;
}

function setCached(cache, key, data, ttl = GRID_CACHE_TTL_MS) {
    cache.set(key, { data, expiresAt: Date.now() + ttl });
}

function send(type, payload) {
    if (!dataPluginsSocket || dataPluginsSocket.readyState !== WebSocket.OPEN) return;
    try { dataPluginsSocket.send(JSON.stringify({ type, ...payload })); }
    catch (e) { logError(`[${PLUGIN_NAME}] send failed: ${e.message}`); }
}

function addWaiter(map, key, requestId) {
    if (!map.has(key)) map.set(key, { ids: new Set(), startedAt: Date.now() });
    map.get(key).ids.add(requestId);
}

function consumeWaiters(map, key) {
    const entry = map.get(key);
    map.delete(key);
    return entry ? Array.from(entry.ids) : [];
}

async function handleGridRequest(requestId, lat, lon, radius) {
    const numLat = parseFloat(lat);
    const numLon = parseFloat(lon);
    const numRadius = parseInt(radius);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLon) || !Number.isFinite(numRadius)) {
        send('Plugin-Tropo-Grid-Response', { requestIds: [requestId], ok: false, error: 'invalid coordinates' });
        return;
    }
    const key = roundKey(numLat, numLon, numRadius);
    const cached = getCached(gridCache, key);
    if (cached) {
        send('Plugin-Tropo-Grid-Response', { requestIds: [requestId], ok: true, time: cached.time, grid: cached.grid, bounds: cached.bounds, locationName: cached.locationName, forecastHours: FORECAST_HOURS });
        return;
    }
    if (gridInflight.has(key)) {
        addWaiter(gridInflight, key, requestId);
        return;
    }
    addWaiter(gridInflight, key, requestId);
    try {
        const data = await fetchGrid(numLat, numLon, numRadius);
        setCached(gridCache, key, data);
        const waiters = consumeWaiters(gridInflight, key);
        // Serialise the payload once and fan it out to every waiter
        // in a single message, instead of re-stringifying it per waiter.
        send('Plugin-Tropo-Grid-Response', { requestIds: waiters, ok: true, time: data.time, grid: data.grid, bounds: data.bounds, locationName: data.locationName, forecastHours: FORECAST_HOURS });
    } catch (e) {
        const waiters = consumeWaiters(gridInflight, key);
        const msg = e && e.message ? e.message : 'fetch failed';
        logError(`[${PLUGIN_NAME}] grid fetch failed (${key}): ${msg}`);
        send('Plugin-Tropo-Grid-Response', { requestIds: waiters, ok: false, error: msg });
    }
}

async function handlePointRequest(requestId, lat, lon) {
    const numLat = parseFloat(lat);
    const numLon = parseFloat(lon);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLon)) {
        send('Plugin-Tropo-Point-Response', { requestId, ok: false, error: 'invalid coordinates' });
        return;
    }
    const key = roundKey(numLat, numLon);
    const cached = getCached(pointCache, key);
    if (cached) {
        send('Plugin-Tropo-Point-Response', { requestId, ok: true, index: cached.index });
        return;
    }
    if (pointInflight.has(key)) {
        addWaiter(pointInflight, key, requestId);
        return;
    }
    addWaiter(pointInflight, key, requestId);
    try {
        const json = await fetchPoint(numLat, numLon);
        const index = json.hourly ? Math.round(calculateTropoIndexPrecise(json.hourly, 0) * 100) / 100 : 0;
        setCached(pointCache, key, { index }, POINT_CACHE_TTL_MS);
        const waiters = consumeWaiters(pointInflight, key);
        waiters.forEach(rid => send('Plugin-Tropo-Point-Response', { requestId: rid, ok: true, index }));
    } catch (e) {
        const waiters = consumeWaiters(pointInflight, key);
        const msg = e && e.message ? e.message : 'fetch failed';
        logError(`[${PLUGIN_NAME}] point fetch failed (${key}): ${msg}`);
        waiters.forEach(rid => send('Plugin-Tropo-Point-Response', { requestId: rid, ok: false, error: msg }));
    }
}

function cleanupInflight() {
    const now = Date.now();
    for (const [k, v] of gridInflight) {
        if (now - v.startedAt > INFLIGHT_TIMEOUT_MS) gridInflight.delete(k);
    }
    for (const [k, v] of pointInflight) {
        if (now - v.startedAt > INFLIGHT_TIMEOUT_MS) pointInflight.delete(k);
    }
    for (const [k, v] of gridCache) if (v.expiresAt < now) gridCache.delete(k);
    for (const [k, v] of pointCache) if (v.expiresAt < now) pointCache.delete(k);
}

function connect() {
    dataPluginsSocket = new WebSocket(externalWsUrl + '/data_plugins');

    dataPluginsSocket.on('open', () => {
        logInfo(`[${PLUGIN_NAME}] connected to /data_plugins`);
    });

    dataPluginsSocket.on('message', async (raw) => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return; }
        if (!parsed || !parsed.type) return;
        if (parsed.type === 'Plugin-Tropo-Grid-Request') {
            await handleGridRequest(parsed.requestId, parsed.lat, parsed.lon, parsed.radius);
        } else if (parsed.type === 'Plugin-Tropo-Point-Request') {
            await handlePointRequest(parsed.requestId, parsed.lat, parsed.lon);
        }
    });

    dataPluginsSocket.on('error', (e) => {
        logError(`[${PLUGIN_NAME}] ws error: ${e.message || e}`);
    });

    dataPluginsSocket.on('close', () => {
        setTimeout(connect, 5000);
    });
}

connect();
setInterval(cleanupInflight, CLEANUP_INTERVAL_MS);
