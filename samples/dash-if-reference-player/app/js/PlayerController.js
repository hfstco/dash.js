/**
 * PlayerController.js - dash.js player lifecycle, event handling, metrics polling
 */

import {EventEmitter} from './UIHelpers.js';

export class PlayerController extends EventEmitter {
    constructor() {
        super();
        this.player = null;
        this.video = null;
        this.isDynamic = false;
        this.periodCount = 0;
        this.activePeriodId = '';
        this.bufferingPeriodId = '';
        this.selectedKeySystem = '';
        this.persistentSessionId = '';
        this.conformanceViolations = [];
        this._metricsInterval = null;
        this._metricsTickCount = 0;
        this._sessionStartTime = 0;
        this._currentRenderedRep = { video: null, audio: null };
        this._metricsHistory = [];
        this._playerEvents = [];
        this._eventNamesByType = {};
        this._segmentRequests = [];
        this._abrRuleLog = [];
    }

    /**
     * Initialize the dash.js player
     * @param {HTMLVideoElement} videoElement
     * @param {boolean} autoPlay
     */
    init(videoElement, autoPlay = true) {
        this.video = videoElement;

        /* global dashjs */
        this.player = dashjs.MediaPlayer().create();
        this.player.initialize(this.video, null, autoPlay);

        // Store on window for console debugging
        window.player = this.player;

        this._registerEvents();
    }

    /**
     * Get the player version string
     * @returns {string}
     */
    getVersion() {
        return this.player ? this.player.getVersion() : '';
    }

    /**
     * Apply a configuration object to the player
     * @param {Object} config
     */
    updateSettings(config) {
        if (this.player) {
            this.player.updateSettings(config);
        }
    }

    /**
     * Get current player settings
     * @returns {Object}
     */
    getSettings() {
        return this.player ? this.player.getSettings() : {};
    }

    /**
     * Load a stream
     * @param {string} url - MPD URL
     * @param {Object} [protectionData] - DRM protection data
     */
    load(url, protectionData) {
        if (!this.player || !url) {
            return;
        }

        this._resetSession();

        if (protectionData && Object.keys(protectionData).length > 0) {
            this.player.setProtectionData(protectionData);
        }

        this.player.attachSource(url);
        this.emit('loaded', { url });
    }

    /**
     * Stop playback and detach source
     */
    stop() {
        if (!this.player) {
            return;
        }

        this._stopMetricsPolling();
        this.player.attachSource(null);
        this.isDynamic = false;
        this.periodCount = 0;
        this.activePeriodId = '';
        this.bufferingPeriodId = '';
        this._currentRenderedRep = { video: null, audio: null };
        this.conformanceViolations = [];
        this.emit('stopped');
    }

    /**
     * Set initial media settings for a type
     * @param {string} type - 'audio', 'video', or 'text'
     * @param {Object} settings
     */
    setInitialMediaSettings(type, settings) {
        if (this.player) {
            this.player.setInitialMediaSettingsFor(type, settings);
        }
    }

    /**
     * Enable forced text streaming
     * @param {boolean} enabled
     */
    enableForcedTextStreaming(enabled) {
        if (this.player) {
            this.player.enableForcedTextStreaming(enabled);
        }
    }

    /**
     * Attach TTML rendering div
     * @param {HTMLElement} div
     */
    attachTTMLRenderingDiv(div) {
        if (this.player) {
            this.player.attachTTMLRenderingDiv(div);
        }
    }

    /**
     * Get elapsed time since session start
     * @returns {number} seconds
     */
    getSessionTime() {
        if (!this._sessionStartTime) {
            return 0;
        }
        return (Date.now() - this._sessionStartTime) / 1000;
    }

    /**
     * Build a comprehensive metrics snapshot suitable for export
     * @returns {Object|null}
     */
    getAllMetricsSnapshot() {
        if (!this.player) {
            return null;
        }

        const dashMetrics = this.player.getDashMetrics();
        const safe = (fn) => {
            try {
                return fn();
            } catch (e) {
                return null;
            }
        };

        const snapshot = {
            timestamp: new Date().toISOString(),
            sessionTime: this.getSessionTime(),
            version: this.getVersion(),
            source: safe(() => this.player.getSource()) || null,
            isDynamic: this.isDynamic,
            periodCount: this.periodCount,
            activePeriodId: this.activePeriodId,
            bufferingPeriodId: this.bufferingPeriodId,
            selectedKeySystem: this.selectedKeySystem,
            persistentSessionId: this.persistentSessionId,
            currentTime: this.video ? this.video.currentTime : 0,
            duration: this.video ? this.video.duration : 0,
            paused: this.video ? this.video.paused : true,
            playbackRate: safe(() => this.player.getPlaybackRate()),
            settings: safe(() => this.player.getSettings()),
            conformanceViolations: this.conformanceViolations.map(v => v && v.event ? v.event : v),
            playerEvents: this._playerEvents.slice(),
            segmentRequests: this._segmentRequests.slice(),
            abrRules: this._abrRuleLog.slice(),
            history: this._metricsHistory.slice(),
            video: this._buildTypeSnapshot('video', dashMetrics, safe),
            audio: this._buildTypeSnapshot('audio', dashMetrics, safe)
        };

        if (this.isDynamic) {
            snapshot.live = {
                currentLatency: safe(() => this.player.getCurrentLiveLatency()),
                targetDelay: safe(() => this.player.getTargetLiveDelay()),
                dvrWindow: safe(() => this.player.getDvrWindow())
            };
        }

        return snapshot;
    }

    /**
     * Destroy the player
     */
    destroy() {
        this._stopMetricsPolling();
        if (this.player) {
            this.player.destroy();
            this.player = null;
        }
    }

    // --- Private methods ---

    _buildTypeSnapshot(type, dashMetrics, safe) {
        if (!dashMetrics) {
            return null;
        }
        return {
            gathered: this._gatherMetrics(type, dashMetrics),
            bufferLevel: safe(() => dashMetrics.getCurrentBufferLevel(type)),
            bufferState: safe(() => dashMetrics.getCurrentBufferState(type)),
            representationSwitch: safe(() => dashMetrics.getCurrentRepresentationSwitch(type)),
            droppedFrames: safe(() => dashMetrics.getCurrentDroppedFrames()),
            httpRequests: safe(() => dashMetrics.getHttpRequests(type)),
            currentTrack: safe(() => this.player.getCurrentTrackFor(type)),
            tracksFor: safe(() => this.player.getTracksFor(type)),
            averageThroughput: safe(() => this.player.getAverageThroughput(type)),
            representations: safe(() => this.player.getRepresentationsByType(type))
        };
    }

    _resetSession() {
        this._sessionStartTime = Date.now();
        this._metricsTickCount = 0;
        this._currentRenderedRep = { video: null, audio: null };
        this.conformanceViolations = [];
        this._metricsHistory = [];
        this._playerEvents = [];
        this._segmentRequests = [];
        this._abrRuleLog = [];
        this.emit('sessionReset');
    }

    _registerEvents() {
        const events = dashjs.MediaPlayer.events;
        this._eventNamesByType = this._buildEventNamesByType(events);

        this.player.on(events.ERROR, (e) => this._onError(e));
        this.player.on(events.MANIFEST_LOADED, (e) => this._onManifestLoaded(e));
        this.player.on(events.REPRESENTATION_SWITCH, (e) => this._onRepresentationSwitch(e));
        this.player.on(events.PERIOD_SWITCH_COMPLETED, (e) => this._onPeriodSwitchCompleted(e));
        this.player.on(events.QUALITY_CHANGE_RENDERED, (e) => this._onQualityChangeRendered(e));
        this.player.on(events.STREAM_INITIALIZED, (e) => this._onStreamInitialized(e));
        this.player.on(events.PLAYBACK_ENDED, (e) => this._onPlaybackEnded(e));
        this.player.on(events.KEY_SYSTEM_SELECTED, (e) => this._onKeySystemSelected(e));
        this.player.on(events.KEY_SESSION_CREATED, (e) => this._onKeySessionCreated(e));
        this.player.on(events.CONFORMANCE_VIOLATION, (e) => this._onConformanceViolation(e));
        this.player.on(events.LOG, (e) => this._onLog(e));
        this.player.on(events.FRAGMENT_LOADING_STARTED, (e) => this._onSegmentRequestStarted(e));
        this.player.on(events.FRAGMENT_LOADING_COMPLETED, (e) => this._onSegmentRequestCompleted(e));
        this.player.on(events.FRAGMENT_LOADING_ABANDONED, (e) => this._onSegmentRequestAbandoned(e));
        this.player.on(events.QUALITY_CHANGE_REQUESTED, (e) => this._onAbrRuleDecision(e));

        for (const type of Object.keys(this._eventNamesByType)) {
            this.player.on(type, (e) => this._recordPlayerEvent(e));
        }
    }

    _buildEventNamesByType(events) {
        const namesByType = {};

        for (const [name, type] of Object.entries(events)) {
            if (typeof type !== 'string' || type === events.EVENT_MODE_ON_START || type === events.EVENT_MODE_ON_RECEIVE) {
                continue;
            }
            namesByType[type] = namesByType[type] || [];
            namesByType[type].push(name);
        }

        return namesByType;
    }

    _recordPlayerEvent(e) {
        if (!e || !e.type) {
            return;
        }

        this._playerEvents.push({
            timestamp: new Date().toISOString(),
            sessionTime: this.getSessionTime(),
            type: e.type,
            names: this._eventNamesByType[e.type] || [],
            data: this._cloneForExport(e)
        });
    }

    _cloneForExport(value, depth = 0, seen = new WeakSet()) {
        const MAX_DEPTH = 6;
        const MAX_ARRAY_ITEMS = 100;

        if (value === null || typeof value !== 'object') {
            return typeof value === 'function' ? undefined : value;
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (seen.has(value)) {
            return '[Circular]';
        }
        if (depth >= MAX_DEPTH) {
            return '[MaxDepth]';
        }
        if (typeof Event !== 'undefined' && value instanceof Event) {
            return {
                type: value.type,
                timeStamp: value.timeStamp
            };
        }
        if (typeof Element !== 'undefined' && value instanceof Element) {
            return {
                nodeName: value.nodeName,
                id: value.id || undefined,
                className: value.className || undefined
            };
        }

        seen.add(value);

        if (Array.isArray(value)) {
            const clone = value.slice(0, MAX_ARRAY_ITEMS).map(item => this._cloneForExport(item, depth + 1, seen));
            if (value.length > MAX_ARRAY_ITEMS) {
                clone.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
            }
            seen.delete(value);
            return clone;
        }

        const clone = {};
        for (const [key, item] of Object.entries(value)) {
            const clonedItem = this._cloneForExport(item, depth + 1, seen);
            if (clonedItem !== undefined) {
                clone[key] = clonedItem;
            }
        }

        seen.delete(value);
        return clone;
    }

    _onSegmentRequestStarted(e) {
        const request = e && e.request;
        if (!this._isSegmentRequest(request)) {
            return;
        }

        this._segmentRequests.push({
            id: this._segmentRequests.length + 1,
            startedAt: new Date().toISOString(),
            completedAt: null,
            sessionTime: this.getSessionTime(),
            status: 'started',
            request: this._buildSegmentRequestLog(request),
            response: null,
            error: null
        });
    }

    _onSegmentRequestCompleted(e) {
        const request = e && e.request;
        if (!this._isSegmentRequest(request)) {
            return;
        }

        const entry = this._findSegmentRequestEntry(request);
        if (!entry) {
            return;
        }

        entry.completedAt = new Date().toISOString();
        entry.durationMs = this._calculateRequestDuration(request);
        entry.status = e.error ? 'failed' : 'completed';
        entry.request = this._buildSegmentRequestLog(request);
        entry.response = this._buildSegmentResponseLog(request, e.response);
        entry.error = e.error ? this._cloneForExport(e.error) : null;
    }

    _onSegmentRequestAbandoned(e) {
        const request = e && e.request;
        if (!this._isSegmentRequest(request)) {
            return;
        }

        const entry = this._findSegmentRequestEntry(request);
        if (!entry) {
            return;
        }

        entry.completedAt = new Date().toISOString();
        entry.durationMs = this._calculateRequestDuration(request);
        entry.status = 'abandoned';
        entry.request = this._buildSegmentRequestLog(request);
    }

    _isSegmentRequest(request) {
        return request && [
            'MediaSegment',
            'InitializationSegment',
            'IndexSegment',
            'BitstreamSwitchingSegment',
            'FragmentInfoSegment'
        ].includes(request.type);
    }

    _findSegmentRequestEntry(request) {
        for (let i = this._segmentRequests.length - 1; i >= 0; i--) {
            const entry = this._segmentRequests[i];
            if (entry.status === 'started' && this._isSameSegmentRequest(entry.request, request)) {
                return entry;
            }
        }
        return null;
    }

    _isSameSegmentRequest(entryRequest, request) {
        return entryRequest &&
            entryRequest.url === request.url &&
            entryRequest.range === (request.range || null) &&
            entryRequest.mediaType === (request.mediaType || null) &&
            entryRequest.type === (request.type || null);
    }

    _buildSegmentRequestLog(request) {
        const representation = request.representation || {};

        return {
            url: request.url || null,
            mediaType: request.mediaType || null,
            type: request.type || null,
            range: request.range || null,
            headers: this._cloneForExport(request.headers || {}),
            startDate: this._dateToISOString(request.startDate),
            firstByteDate: this._dateToISOString(request.firstByteDate),
            endDate: this._dateToISOString(request.endDate),
            startTime: this._numberOrNull(request.startTime),
            duration: this._numberOrNull(request.duration),
            mediaStartTime: this._numberOrNull(request.mediaStartTime),
            presentationStartTime: this._numberOrNull(request.presentationStartTime),
            index: this._numberOrNull(request.index),
            bandwidth: this._numberOrNull(request.bandwidth),
            retryAttempts: request.retryAttempts || 0,
            serviceLocation: request.serviceLocation || null,
            fileLoaderType: request.fileLoaderType || null,
            representation: {
                id: representation.id || null,
                bandwidth: this._numberOrNull(representation.bandwidth),
                width: this._numberOrNull(representation.width),
                height: this._numberOrNull(representation.height),
                codecs: representation.codecs || null
            }
        };
    }

    _buildSegmentResponseLog(request, response) {
        const httpRequest = this._findHttpRequestMetric(request);

        return {
            url: httpRequest ? httpRequest.actualurl || httpRequest.url : request.url || null,
            status: httpRequest ? httpRequest.responsecode : null,
            headers: httpRequest ? this._parseResponseHeaders(httpRequest._responseHeaders) : null,
            bytesLoaded: this._numberOrNull(request.bytesLoaded),
            bytesTotal: this._numberOrNull(request.bytesTotal),
            bodyLength: this._getBodyLength(response),
            traces: request.traces ? this._cloneForExport(request.traces) : null,
            cmsd: httpRequest && httpRequest.cmsd ? this._cloneForExport(httpRequest.cmsd) : null,
            resourceTiming: request.resourceTimingValues ? this._cloneForExport(request.resourceTimingValues) : null
        };
    }

    _findHttpRequestMetric(request) {
        try {
            const httpRequests = this.player.getDashMetrics().getHttpRequests(request.mediaType);
            if (!httpRequests || httpRequests.length === 0) {
                return null;
            }

            for (let i = httpRequests.length - 1; i >= 0; i--) {
                const httpRequest = httpRequests[i];
                if (httpRequest &&
                    httpRequest.url === request.url &&
                    (httpRequest.range || null) === (request.range || null) &&
                    httpRequest.type === request.type) {
                    return httpRequest;
                }
            }
        } catch (e) {
            return null;
        }

        return null;
    }

    _parseResponseHeaders(headerString) {
        if (!headerString) {
            return {};
        }

        return headerString.trim().split(/\r?\n/).reduce((headers, line) => {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex > -1) {
                headers[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
            }
            return headers;
        }, {});
    }

    _calculateRequestDuration(request) {
        if (request.startDate instanceof Date && request.endDate instanceof Date) {
            return request.endDate.getTime() - request.startDate.getTime();
        }
        return null;
    }

    _getBodyLength(response) {
        if (!response) {
            return 0;
        }
        if (typeof response.byteLength === 'number') {
            return response.byteLength;
        }
        if (typeof response.length === 'number') {
            return response.length;
        }
        return null;
    }

    _dateToISOString(date) {
        return date instanceof Date ? date.toISOString() : null;
    }

    _numberOrNull(value) {
        return typeof value === 'number' && !isNaN(value) ? value : null;
    }

    _onAbrRuleDecision(e) {
        if (!e || !e.reason) {
            return;
        }

        this._abrRuleLog.push({
            timestamp: new Date().toISOString(),
            sessionTime: this.getSessionTime(),
            mediaType: e.mediaType || null,
            streamId: e.streamInfo ? e.streamInfo.id : null,
            rules: this._getAbrRuleNames(e.reason),
            oldRepresentation: this._buildRepresentationLog(e.oldRepresentation),
            newRepresentation: this._buildRepresentationLog(e.newRepresentation),
            isAdaptationSetSwitch: !!e.isAdaptationSetSwitch,
            forceAbandon: !!e.reason.forceAbandon,
            reason: this._cloneForExport(e.reason)
        });
    }

    _getAbrRuleNames(reason) {
        const names = [];

        if (reason.message) {
            const matches = reason.message.matchAll(/\[([^\]]+Rule)\]/g);
            for (const match of matches) {
                names.push(match[1]);
            }
        }
        if (reason.state && reason.state.indexOf('BOLA_') === 0) {
            names.push('BolaRule');
        }
        if (reason.state && reason.state.indexOf('L2A_') === 0) {
            names.push('L2ARule');
        }
        if (reason.forceAbandon) {
            names.push('AbandonRequestsRule');
        }
        if (names.length === 0 && reason.throughput !== undefined && reason.latency !== undefined) {
            names.push('LoLPRule');
        }

        return [...new Set(names)];
    }

    _buildRepresentationLog(representation) {
        if (!representation) {
            return null;
        }

        return {
            id: representation.id || null,
            absoluteIndex: this._numberOrNull(representation.absoluteIndex),
            bitrateInKbit: this._numberOrNull(representation.bitrateInKbit),
            bandwidth: this._numberOrNull(representation.bandwidth),
            width: this._numberOrNull(representation.width),
            height: this._numberOrNull(representation.height),
            codecs: representation.codecs || null
        };
    }

    _onError(e) {
        this.emit('error', e);
    }

    _onManifestLoaded(e) {
        if (e.data) {
            this.isDynamic = e.data.type === 'dynamic';
            this.periodCount = e.data.Period ? e.data.Period.length : 0;
        }
        this.emit('manifestLoaded', {
            isDynamic: this.isDynamic,
            periodCount: this.periodCount
        });
    }

    _onRepresentationSwitch(e) {
        this.emit('representationSwitch', e);
    }

    _onPeriodSwitchCompleted(e) {
        if (e.toStreamInfo) {
            this.activePeriodId = e.toStreamInfo.id || '';
        }
        this.emit('periodSwitchCompleted', {
            activePeriodId: this.activePeriodId
        });
    }

    _onQualityChangeRendered(e) {
        if (e && e.mediaType && e.newRepresentation) {
            this._currentRenderedRep[e.mediaType] = e.newRepresentation;
        }
        this.emit('qualityChangeRendered', e);
    }

    _onStreamInitialized() {
        this._startMetricsPolling();
        this.emit('streamInitialized');
    }

    _onPlaybackEnded() {
        this.emit('playbackEnded');
    }

    _onKeySystemSelected(e) {
        if (e.data) {
            this.selectedKeySystem = e.data.keySystem
                ? e.data.keySystem.systemString
                : '';
        }
        this.emit('keySystemSelected', {
            keySystem: this.selectedKeySystem
        });
    }

    _onKeySessionCreated(e) {
        if (e.data) {
            this.persistentSessionId = e.data.sessionID || '';
        }
    }

    _onConformanceViolation(e) {
        if (e && e.event) {
            const key = e.event.key;
            const exists = this.conformanceViolations.some(v => v.event && v.event.key === key);
            if (!exists) {
                this.conformanceViolations.push(e);
                this.emit('conformanceViolation', e);
            }
        }
    }

    _onLog(e) {
        // Only forward warning (3), error (2), and fatal (1) log messages
        if (e && e.level <= 3) {
            this.emit('log', { level: e.level, message: e.message });
        }
    }

    _startMetricsPolling() {
        this._stopMetricsPolling();
        this._metricsInterval = setInterval(() => this._pollMetrics(), 1000);
    }

    _stopMetricsPolling() {
        if (this._metricsInterval) {
            clearInterval(this._metricsInterval);
            this._metricsInterval = null;
        }
    }

    _pollMetrics() {
        if (!this.player) {
            return;
        }

        this._metricsTickCount++;
        const dashMetrics = this.player.getDashMetrics();

        if (!dashMetrics) {
            return;
        }

        const sessionTime = this.getSessionTime();
        const plotEveryOtherTick = this._metricsTickCount % 2 === 0;

        const tick = {
            timestamp: new Date().toISOString(),
            sessionTime,
            currentTime: this.video ? this.video.currentTime : 0
        };

        for (const type of ['video', 'audio']) {
            const metrics = this._gatherMetrics(type, dashMetrics);
            tick[type] = metrics;
            this.emit('metricsUpdate', {
                type,
                metrics,
                sessionTime,
                shouldPlot: plotEveryOtherTick
            });
        }

        this._metricsHistory.push(tick);
    }

    _gatherMetrics(type, dashMetrics) {
        const metrics = {};

        try {
            // Buffer level
            metrics.bufferLevel = dashMetrics.getCurrentBufferLevel(type, true) || 0;

            // Representations (display as 1-based: 1/N instead of 0/N)
            const reps = this.player.getRepresentationsByType(type);
            metrics.maxIndex = reps ? reps.length : 0;

            // Index (downloading) — from representation switch metric
            const repSwitch = dashMetrics.getCurrentRepresentationSwitch(type, true);
            if (repSwitch) {
                const pendingIdx = reps
                    ? reps.findIndex(r => r.id === repSwitch.to)
                    : -1;
                metrics.pendingIndex = pendingIdx + 1;
            }

            // Index (playing) — from QUALITY_CHANGE_RENDERED event
            const renderedRep = this._currentRenderedRep[type];
            if (renderedRep) {
                const currentIdx = reps
                    ? reps.findIndex(r => r.id === renderedRep.id)
                    : -1;
                metrics.currentIndex = currentIdx + 1;
                metrics.bitrate = Math.round(renderedRep.bandwidth / 1000);

                // Resolution (video only)
                if (type === 'video' && renderedRep.width && renderedRep.height) {
                    metrics.resolution = `${renderedRep.width}x${renderedRep.height}`;
                }

                // Framerate (video only)
                if (type === 'video' && renderedRep.frameRate) {
                    metrics.framerate = renderedRep.frameRate;
                }

                // Segment duration
                if (renderedRep.fragmentDuration && !isNaN(renderedRep.fragmentDuration)) {
                    metrics.segmentDuration = renderedRep.fragmentDuration;
                }
            }

            // Dropped frames
            const droppedFrames = dashMetrics.getCurrentDroppedFrames();
            metrics.droppedFrames = droppedFrames ? droppedFrames.droppedFrames : 0;

            // Average throughput
            metrics.throughput = Math.round(this.player.getAverageThroughput(type) || 0);

            // Codec
            try {
                const currentTrack = this.player.getCurrentTrackFor(type);
                if (currentTrack && currentTrack.codec) {
                    metrics.codec = currentTrack.codec;
                }
            } catch (e) {
                // Track may not be available yet
            }

            // Buffer state
            const bufferState = dashMetrics.getCurrentBufferState(type);
            if (bufferState) {
                metrics.bufferState = bufferState.state;
            }

            // HTTP metrics
            const httpMetrics = this._calculateHTTPMetrics(type, dashMetrics);
            Object.assign(metrics, httpMetrics);

            // Playback rate (applicable to all content types)
            metrics.playbackRate = this.player.getPlaybackRate() || 1;

            // Live-specific metrics
            if (this.isDynamic) {
                metrics.liveLatency = this.player.getCurrentLiveLatency() || 0;

                // Target live delay and DVR window (video only to avoid duplicates)
                if (type === 'video') {
                    metrics.targetDelay = this.player.getTargetLiveDelay() || 0;
                    const dvrWindow = this.player.getDvrWindow();
                    if (dvrWindow && dvrWindow.size) {
                        metrics.dvrWindowSize = dvrWindow.size;
                    }
                }
            }

            // Throughput (legacy field — kept for chart plotting)
            metrics.averageThroughput = this.player.getAverageThroughput(type) || 0;

        } catch (err) {
            // Metrics may not be available yet
        }

        return metrics;
    }

    _calculateHTTPMetrics(type, dashMetrics) {
        const result = {
            latencyMin: 0, latencyAvg: 0, latencyMax: 0,
            downloadMin: 0, downloadAvg: 0, downloadMax: 0,
            ratioMin: 0, ratioAvg: 0, ratioMax: 0,
            mtp: 0, etp: 0
        };

        try {
            const httpRequests = dashMetrics.getHttpRequests(type);
            if (!httpRequests || httpRequests.length === 0) {
                return result;
            }

            // Take last 4 completed requests
            const completed = httpRequests.filter(r =>
                r.responsecode >= 200 && r.responsecode < 300 &&
                r.type === 'MediaSegment' &&
                r.tresponse && r.trequest &&
                r.tfinish && r.tresponse
            ).slice(-4);

            if (completed.length === 0) {
                return result;
            }

            const latencies = [];
            const downloads = [];
            const ratios = [];

            for (const req of completed) {
                const latency = req.tresponse.getTime() - req.trequest.getTime();
                const download = req.tfinish.getTime() - req.tresponse.getTime();
                latencies.push(latency);
                downloads.push(download);

                // Calculate ratio (download / segment duration)
                if (req.mediaduration && req.mediaduration > 0) {
                    const ratio = download / (req.mediaduration * 1000);
                    ratios.push(ratio);
                }

                // CMSD metrics
                if (req.cmsd) {
                    if (req.cmsd.dynamic && req.cmsd.dynamic.mtp) {
                        result.mtp = req.cmsd.dynamic.mtp;
                    }
                    if (req.cmsd.dynamic && req.cmsd.dynamic.etp) {
                        result.etp = req.cmsd.dynamic.etp;
                    }
                }
            }

            if (latencies.length > 0) {
                result.latencyMin = Math.min(...latencies);
                result.latencyMax = Math.max(...latencies);
                result.latencyAvg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
            }
            if (downloads.length > 0) {
                result.downloadMin = Math.min(...downloads);
                result.downloadMax = Math.max(...downloads);
                result.downloadAvg = Math.round(downloads.reduce((a, b) => a + b, 0) / downloads.length);
            }
            if (ratios.length > 0) {
                result.ratioMin = Math.min(...ratios).toFixed(2);
                result.ratioMax = Math.max(...ratios).toFixed(2);
                result.ratioAvg = (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2);
            }
        } catch (err) {
            // Metrics may not be available yet
        }

        return result;
    }
}
