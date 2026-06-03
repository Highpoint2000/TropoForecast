    /////////////////////////////////////////////////////////////////////
    ///                                                               ///
    ///  TROPO FORECAST (SERVER MODUL) FOR FM-DX-WEBSERVER      V2.0  ///
    ///                                                               ///
    ///  by Highpoint                        last update: 2026-06-03  ///
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

function httpGetJson(url) {
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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${buildHourlyParams()}&forecast_hours=${FORECAST_HOURS}&models=best_match`;
    const json = await httpGetJson(url);
    let results = [];
    if (json.hourly) results = [json];
    else if (Array.isArray(json)) results = json;
    else throw new Error('invalid grid response');

    // Separate minimal request with timezone=auto to get the local timezone name
    const tzUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto&hourly=temperature_2m&forecast_hours=1&models=best_match`;
    const tzJson = await httpGetJson(tzUrl).catch(() => null);
    const locationName = tzJson ? parseLocationName(tzJson.timezone) : null;

    return { results, bounds, locationName };
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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${buildHourlyParams()}&forecast_hours=1&models=best_match`;
    return await httpGetJson(url);
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
        send('Plugin-Tropo-Grid-Response', { requestId, ok: false, error: 'invalid coordinates' });
        return;
    }
    const key = roundKey(numLat, numLon, numRadius);
    const cached = getCached(gridCache, key);
    if (cached) {
        send('Plugin-Tropo-Grid-Response', { requestId, ok: true, results: cached.results, bounds: cached.bounds, locationName: cached.locationName, forecastHours: FORECAST_HOURS });
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
        waiters.forEach(rid => send('Plugin-Tropo-Grid-Response', { requestId: rid, ok: true, results: data.results, bounds: data.bounds, locationName: data.locationName, forecastHours: FORECAST_HOURS }));
    } catch (e) {
        const waiters = consumeWaiters(gridInflight, key);
        const msg = e && e.message ? e.message : 'fetch failed';
        logError(`[${PLUGIN_NAME}] grid fetch failed (${key}): ${msg}`);
        waiters.forEach(rid => send('Plugin-Tropo-Grid-Response', { requestId: rid, ok: false, error: msg }));
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
        send('Plugin-Tropo-Point-Response', { requestId, ok: true, hourly: cached.hourly });
        return;
    }
    if (pointInflight.has(key)) {
        addWaiter(pointInflight, key, requestId);
        return;
    }
    addWaiter(pointInflight, key, requestId);
    try {
        const json = await fetchPoint(numLat, numLon);
        setCached(pointCache, key, json, POINT_CACHE_TTL_MS);
        const waiters = consumeWaiters(pointInflight, key);
        waiters.forEach(rid => send('Plugin-Tropo-Point-Response', { requestId: rid, ok: true, hourly: json.hourly }));
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
