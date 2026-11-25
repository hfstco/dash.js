/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
import FactoryMaker from '../../core/FactoryMaker.js';
import Debug from '../../core/Debug.js';
import Settings from '../../core/Settings.js';
import DOMStorage from '../utils/DOMStorage.js';

/**
 * Decides whether the startup burst of streaming.carefulResume is requested.
 *
 * A client cannot see whether the server holds saved congestion control parameters for its path (RFC 9959), and a
 * web page can neither see TLS session resumption nor 0-RTT. What the client does know is the condition under which
 * the server can have saved these parameters: this client loaded video from the same host a short time ago.
 */
function CarefulResumeController() {
    const context = this.context;
    const settings = Settings(context).getInstance();

    let instance,
        burstDecided,
        domStorage,
        logger;

    function setup() {
        logger = Debug(context).getInstance().getLogger(instance);
        domStorage = DOMStorage(context).getInstance({ settings });
        burstDecided = false;
    }

    /**
     * To be called for the first video segment request. Decides once per source, because the jump of Careful Resume
     * is only available at the start of a connection.
     * @param {string} url of the segment
     * @return {boolean}
     */
    function shouldRequestBurst(url) {
        const crSettings = settings.get().streaming.carefulResume;
        if (burstDecided || !crSettings.enabled) {
            return false;
        }
        burstDecided = true;

        const host = _getHost(url);
        const protocol = _getNextHopProtocol(host);
        // Careful Resume needs QUIC. Without HTTP/3 the burst would also not share one connection.
        if (protocol && !protocol.startsWith('h3')) {
            logger.info(`Careful Resume: no burst, ${host} is reached with ${protocol}`);
            return false;
        }
        if (crSettings.requireReturningClient && domStorage.getSavedCarefulResumeHost() !== host) {
            logger.info(`Careful Resume: no burst, no recent video download from ${host}`);
            return false;
        }

        return true;
    }

    /**
     * Remembers that this client loaded video from the host of the url, so that a later session counts as returning
     * @param {string} url of the segment
     */
    function onVideoSegmentLoaded(url) {
        if (settings.get().streaming.carefulResume.enabled) {
            domStorage.setSavedCarefulResumeHost(_getHost(url));
        }
    }

    function reset() {
        burstDecided = false;
    }

    function _getHost(url) {
        return new URL(url, window.location.href).host;
    }

    /**
     * Protocol of the latest request to the host according to the Resource Timing API. Empty if unknown, for
     * instance for a cross-origin host that does not send Timing-Allow-Origin.
     * @param {string} host
     * @return {string}
     * @private
     */
    function _getNextHopProtocol(host) {
        if (typeof performance === 'undefined' || !performance.getEntriesByType) {
            return '';
        }
        const entry = performance.getEntriesByType('resource')
            .reverse()
            .find(resource => resource.nextHopProtocol && _getHost(resource.name) === host);

        return entry ? entry.nextHopProtocol : '';
    }

    instance = {
        onVideoSegmentLoaded,
        reset,
        shouldRequestBurst
    };

    setup();

    return instance;
}

CarefulResumeController.__dashjs_factory_name = 'CarefulResumeController';
export default FactoryMaker.getSingletonFactory(CarefulResumeController);
