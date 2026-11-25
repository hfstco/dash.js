import CarefulResumeController from '../../../../src/streaming/controllers/CarefulResumeController.js';
import Settings from '../../../../src/core/Settings.js';

import {expect} from 'chai';
import sinon from 'sinon';

const STORAGE_KEY = 'dashjs_careful_resume';
const SEGMENT_URL = 'https://video.example.com:4433/video/1.m4s';
const SEGMENT_HOST = 'video.example.com:4433';

describe('CarefulResumeController', () => {
    let context;
    let settings;
    let carefulResumeController;
    let resources;

    function _saveHost(host, age = 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, timestamp: new Date().getTime() - age }));
    }

    beforeEach(() => {
        context = {};
        resources = [];
        localStorage.removeItem(STORAGE_KEY);
        sinon.stub(performance, 'getEntriesByType').callsFake(() => resources.slice());
        settings = Settings(context).getInstance();
        settings.update({ streaming: { carefulResume: { enabled: true } } });
        carefulResumeController = CarefulResumeController(context).getInstance();
    });

    afterEach(() => {
        sinon.restore();
        settings.reset();
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should not request a burst if disabled', () => {
        settings.update({ streaming: { carefulResume: { enabled: false } } });
        _saveHost(SEGMENT_HOST);

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.false;
    });

    it('should not request a burst for a client that did not load video from the host before', () => {
        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.false;
    });

    it('should not request a burst if video was loaded from another host', () => {
        _saveHost('other.example.com');

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.false;
    });

    it('should request a burst for a returning client', () => {
        _saveHost(SEGMENT_HOST);

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.true;
    });

    it('should not request a burst if the last video download is older than returningClientTtl', () => {
        _saveHost(SEGMENT_HOST, 700000);

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.false;
    });

    it('should request a burst for a new client if requireReturningClient is disabled', () => {
        settings.update({ streaming: { carefulResume: { requireReturningClient: false } } });

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.true;
    });

    it('should request only one burst until it is reset', () => {
        _saveHost(SEGMENT_HOST);

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.true;
        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.false;
        carefulResumeController.reset();
        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.true;
    });

    it('should not request a burst if the host is not reached with HTTP/3', () => {
        _saveHost(SEGMENT_HOST);
        resources = [
            { name: 'https://video.example.com:4433/manifest.mpd', nextHopProtocol: 'h3' },
            { name: 'https://video.example.com:4433/video/init.mp4', nextHopProtocol: 'h2' }
        ];

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.false;
    });

    it('should request a burst if the host is reached with HTTP/3', () => {
        _saveHost(SEGMENT_HOST);
        resources = [
            { name: 'https://video.example.com:4433/manifest.mpd', nextHopProtocol: 'h3' },
            { name: 'https://player.example.com/dash.all.min.js', nextHopProtocol: 'h2' }
        ];

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.true;
    });

    it('should request a burst if the protocol is hidden for a cross-origin host', () => {
        _saveHost(SEGMENT_HOST);
        resources = [{ name: 'https://video.example.com:4433/manifest.mpd', nextHopProtocol: '' }];

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.true;
    });

    it('should make the client a returning client once a video segment is loaded', () => {
        carefulResumeController.onVideoSegmentLoaded(SEGMENT_URL);

        expect(carefulResumeController.shouldRequestBurst(SEGMENT_URL)).to.be.true;
    });

    it('should not remember the host if disabled', () => {
        settings.update({ streaming: { carefulResume: { enabled: false } } });
        carefulResumeController.onVideoSegmentLoaded(SEGMENT_URL);

        expect(localStorage.getItem(STORAGE_KEY)).to.be.null;
    });
});
