/**
 * VTube Studio API Manager (WebSocket)
 * 
 * Handles connecting to VTS, authentication, injecting custom parameters (e.g., for lip-sync and dynamic emotions),
 * and triggering hotkeys (for larger actions or pre-defined expressions).
 */

class VTSManager {
    constructor(pluginName = "Realtime AI Widget", developer = "Agent Developer", port = 8001) {
        this.pluginName = pluginName;
        this.developer = developer;
        this.port = port;
        this.ws = null;
        this.authenticated = false;
        this.authToken = localStorage.getItem('vts_auth_token') || null;
        
        this.onConnected = null;
        this.onDisconnected = null;
        this.onError = null;

        // Callback mechanism for API requests
        this._requestCounter = 0;
        this._pendingRequests = new Map();
        
        // Caching active hotkeys to know their IDs
        this.activeHotkeys = [];

        // Parameter buffering for smooth injection
        this._paramBuffer = new Map();
        this._injectionRAF = null;
        this._isInjecting = false;
    }

    /**
     * Connects to VTube Studio via WebSocket.
     */
    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        const url = `ws://localhost:${this.port}`;
        console.log(`[VTS] Connecting to ${url}...`);
        
        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.error('[VTS] Connection failed immediately:', e);
            if (this.onError) this.onError(e);
            return;
        }

        this.ws.onopen = async () => {
            console.log('[VTS] Connected');
            this.authenticated = false;
            
            // Auto authenticate on connect
            try {
                await this.authenticate();
                if (this.authenticated) {
                    await this.requestHotkeys();
                    await this.createCustomParameters();
                    this.startInjectLoop();
                    if (this.onConnected) this.onConnected();
                }
            } catch (err) {
                console.error('[VTS] Initialization after connect failed:', err);
                if (this.onError) this.onError(err);
            }
        };

        this.ws.onclose = () => {
            console.log('[VTS] Disconnected');
            this.authenticated = false;
            this.stopInjectLoop();
            if (this.onDisconnected) this.onDisconnected();

            // Try to reconnect after a delay
            setTimeout(() => this.connect(), 5000);
        };

        this.ws.onerror = (err) => {
            console.error('[VTS] WebSocket Error:', err);
            // close will be called automatically
        };

        this.ws.onmessage = (event) => {
            this._handleMessage(event.data);
        };
    }

    /**
     * Handle incoming WebSocket messages.
     */
    _handleMessage(dataStr) {
        try {
            const data = JSON.parse(dataStr);
            const requestId = data.requestID;

            if (requestId && this._pendingRequests.has(requestId)) {
                const { resolve, reject } = this._pendingRequests.get(requestId);
                this._pendingRequests.delete(requestId);

                if (data.messageType === "APIError") {
                    reject(data.data);
                } else {
                    resolve(data);
                }
            }
        } catch (e) {
            console.error('[VTS] Error parsing JSON:', e);
        }
    }

    /**
     * Sends a request to VTube Studio API.
     */
    async _sendRequest(apiName, data = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('[VTS] WebSocket is not open');
        }

        return new Promise((resolve, reject) => {
            const requestId = `req_${++this._requestCounter}`;
            this._pendingRequests.set(requestId, { resolve, reject });

            const payload = {
                apiName: "VTubeStudioPublicAPI",
                apiVersion: "1.0",
                requestID: requestId,
                messageType: apiName,
                data: data
            };

            this.ws.send(JSON.stringify(payload));
            
            // Timeout cleanup (some requests like AuthenticationRequest might take time if user is clicking "Allow")
            setTimeout(() => {
                if (this._pendingRequests.has(requestId)) {
                    this._pendingRequests.delete(requestId);
                    reject(new Error(`[VTS] Request timeout for ${apiName}`));
                }
            }, apiName === "AuthenticationRequest" ? 60000 : 5000);
        });
    }

    /**
     * Authenticates with VTS. Requests a token if none is saved.
     */
    async authenticate() {
        if (!this.authToken) {
            console.log('[VTS] Requesting new auth token...');
            const res = await this._sendRequest("AuthenticationTokenRequest", {
                pluginName: this.pluginName,
                pluginDeveloper: this.developer,
            });
            this.authToken = res.data.authenticationToken;
            localStorage.setItem('vts_auth_token', this.authToken);
        }

        console.log('[VTS] Authenticating with token...');
        const authRes = await this._sendRequest("AuthenticationRequest", {
            pluginName: this.pluginName,
            pluginDeveloper: this.developer,
            authenticationToken: this.authToken
        });

        if (authRes.data.authenticated) {
            console.log('[VTS] Authenticated successfully!');
            this.authenticated = true;
            return true;
        } else {
            console.warn('[VTS] Auth token invalid. Clearing token.');
            localStorage.removeItem('vts_auth_token');
            this.authToken = null;
            // Retry once
            return this.authenticate();
        }
    }

    /**
     * Initializes any custom tracking parameters needed by the plugin
     */
    async createCustomParameters() {
        if (!this.authenticated) return;
        try {
            console.log('[VTS] Creating/verifying custom parameter: MouthOpenAudio');
            await this._sendRequest("ParameterCreationRequest", {
                parameterName: "MouthOpenAudio",
                explanation: "Realtime AI Widget Audio Lip-sync",
                min: 0.0,
                max: 1.0,
                defaultValue: 0.0
            });
            console.log('[VTS] Custom parameter MouthOpenAudio ready.');
        } catch (e) {
            console.error('[VTS] Failed to create custom parameter:', e);
        }
    }

    /**
     * Set a parameter value to be injected (buffered logic)
     */
    injectParameter(id, value, weight = 1.0) {
        if (!this.authenticated) return;
        this._paramBuffer.set(id, { value, weight });
    }

    /**
     * Continuous loop for InjectParameterDataRequest
     */
    startInjectLoop() {
        if (this._isInjecting) return;
        this._isInjecting = true;
        
        const tick = () => {
            this._injectionRAF = requestAnimationFrame(tick);
            
            if (!this.authenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            if (this._paramBuffer.size === 0) return;

            const parameterValues = [];
            for (const [id, param] of this._paramBuffer.entries()) {
                parameterValues.push({
                    id: id,
                    value: param.value,
                    weight: param.weight
                });
            }

            // Fire and forget (don't wait for response to keep frame rate high)
            const payload = {
                apiName: "VTubeStudioPublicAPI",
                apiVersion: "1.0",
                requestID: "inject_" + Math.random(),
                messageType: "InjectParameterDataRequest",
                data: {
                    faceFound: false, // Don't override tracking if face is found
                    mode: "add", // Add to tracking
                    parameterValues: parameterValues
                }
            };
            
            // To use custom parameters, mode must be "set" or we must ensure VTS allows adding.
            // Using "set" is usually safer for pure custom parameters driven externally.
            payload.data.mode = "set";

            this.ws.send(JSON.stringify(payload));
            
            // Clear buffer after sending so we don't spam default values endlessly
            // Or keep them until explicitly set to 0. 
            // In lip-sync, it's constantly updated, so we can clear or keep.
            // If we clear, the values might reset to default if they drop.
            this._paramBuffer.clear();
        };
        
        this._injectionRAF = requestAnimationFrame(tick);
    }

    stopInjectLoop() {
        this._isInjecting = false;
        if (this._injectionRAF) {
            cancelAnimationFrame(this._injectionRAF);
            this._injectionRAF = null;
        }
    }

    /**
     * Get all hotkeys for the current model
     */
    async requestHotkeys() {
        try {
            const res = await this._sendRequest("HotkeysInCurrentModelRequest", {});
            this.activeHotkeys = res.data.availableHotkeys || [];
            console.log('[VTS] Loaded Hotkeys:', this.activeHotkeys.map(h => h.name));
            return this.activeHotkeys;
        } catch (e) {
            console.error('[VTS] Failed to get hotkeys', e);
            return [];
        }
    }

    /**
     * Trigger a hotkey by its display name.
     * VTS requires hotkeyID, so we look it up by name.
     */
    async triggerHotkey(hotkeyName) {
        if (!this.authenticated) return false;
        
        // Find hotkey ID by name
        let hotkey = this.activeHotkeys.find(h => h.name === hotkeyName || h.name.toLowerCase() === hotkeyName.toLowerCase());
        
        // If not found, maybe model changed, refresh hotkeys
        if (!hotkey) {
            await this.requestHotkeys();
            hotkey = this.activeHotkeys.find(h => h.name === hotkeyName || h.name.toLowerCase() === hotkeyName.toLowerCase());
        }

        if (!hotkey) {
            console.warn(`[VTS] Hotkey "${hotkeyName}" not found on current model.`);
            return false;
        }

        try {
            await this._sendRequest("HotkeyTriggerRequest", {
                hotkeyID: hotkey.hotkeyID
            });
            console.log(`[VTS] Triggered hotkey: ${hotkeyName}`);
            return true;
        } catch (e) {
            console.error(`[VTS] Failed to trigger hotkey ${hotkeyName}`, e);
            return false;
        }
    }
}
