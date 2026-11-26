import ThroughputController from '../../../../src/streaming/controllers/ThroughputController.js';
import Settings from '../../../../src/core/Settings.js';
import PlaybackControllerMock from '../../mocks/PlaybackControllerMock.js';
import EventBus from '../../../../src/core/EventBus.js';
import MediaPlayerEvents from '../../../../src/streaming/MediaPlayerEvents.js';
import Constants from '../../../../src/streaming/constants/Constants.js';

import {expect} from 'chai';
const context = {};
const eventBus = EventBus(context).getInstance();

let httpRequests = [
    {
        'type': 'MediaSegment',
        'url': '1.m4v',
        'trequest': new Date('2022-06-28T09:19:03.000Z'),
        'tresponse': new Date('2022-06-28T09:19:03.000Z'),
        'responsecode': 200,
        'trace': [
            {
                's': '2022-06-28T09:19:03.000Z',
                'd': 500,
                'b': [
                    3000000
                ]
            },
            {
                's': '2022-06-28T09:19:03.500Z',
                'd': 200,
                'b': [
                    2000000
                ]
            },
            {
                's': '2022-06-28T09:19:03.700Z',
                'd': 300,
                'b': [
                    4000000
                ]
            },
        ],
        '_resourceTimingValues': {
            transferSize: 6000000,
            responseEnd: 300,
            responseStart: 100
        },
        '_stream': 'video',
        '_tfinish': new Date('2022-06-28T09:19:04.000Z')
    },
    {
        'type': 'MediaSegment',
        'url': '2.m4v',
        'trequest': new Date('2022-06-28T09:19:03.000Z'),
        'tresponse': new Date('2022-06-28T09:19:03.000Z'),
        'responsecode': 200,
        'trace': [
            {
                's': '2022-06-28T09:19:03.000Z',
                'd': 100,
                'b': [
                    3000000
                ]
            },
            {
                's': '2022-06-28T09:19:03.100Z',
                'd': 100,
                'b': [
                    2000000
                ]
            },
            {
                's': '2022-06-28T09:19:03.200Z',
                'd': 100,
                'b': [
                    4000000
                ]
            }
        ],
        '_resourceTimingValues': {
            transferSize: 1000000,
            responseEnd: 200,
            responseStart: 100
        },
        '_stream': 'video',
        '_tfinish': new Date('2022-06-28T09:19:03.300Z')
    },
    {
        'type': 'MediaSegment',
        'url': '3.m4v',
        'trequest': new Date('2022-06-28T09:19:03.000Z'),
        'tresponse': new Date('2022-06-28T09:19:03.000Z'),
        'responsecode': 200,
        'trace': [
            {
                's': '2022-06-28T09:19:03.000Z',
                'd': 900,
                'b': [
                    3000000
                ]
            },
            {
                's': '2022-06-28T09:19:03.900Z',
                'd': 600,
                'b': [
                    2000000
                ]
            },
            {
                's': '2022-06-28T09:19:04.500Z',
                'd': 1000,
                'b': [
                    4000000
                ]
            }
        ],
        '_resourceTimingValues': {
            transferSize: 2000000,
            responseEnd: 600,
            responseStart: 200
        },
        '_stream': 'video',
        '_tfinish': new Date('2022-06-28T09:19:05.500Z')
    }
]
let mpdRequest = {
    'type': 'MPD',
    'url': '1.m4v',
    'trequest': new Date('2022-06-28T09:19:03.000Z'),
    'tresponse': new Date('2022-06-28T09:19:03.000Z'),
    'responsecode': 200,
    'trace': [
        {
            's': '2022-06-28T09:19:03.000Z',
            'd': 500,
            'b': [
                3000000
            ]
        },
        {
            's': '2022-06-28T09:19:03.500Z',
            'd': 200,
            'b': [
                2000000
            ]
        },
        {
            's': '2022-06-28T09:19:03.700Z',
            'd': 300,
            'b': [
                4000000
            ]
        },
    ],
    '_resourceTimingValues': {
        transferSize: 6000000,
        responseEnd: 300,
        responseStart: 100
    },
    '_stream': 'video',
    '_tfinish': new Date('2022-06-28T09:19:04.000Z')
};

function _addMetrics(numberOfEntries = NaN) {

    if (isNaN(numberOfEntries) || numberOfEntries > httpRequests.length) {
        numberOfEntries = httpRequests.length;
    }

    for (let i = 0; i < numberOfEntries; i++) {
        eventBus.trigger(MediaPlayerEvents.METRIC_ADDED, {
            mediaType: 'video',
            metric: 'HttpList',
            value: httpRequests[i]
        })
    }
}

function _addMpdMetric() {
    eventBus.trigger(MediaPlayerEvents.METRIC_ADDED, {
        mediaType: 'stream',
        metric: 'HttpList',
        value: mpdRequest
    })
}

describe('ThroughputController', () => {
    let throughputController;
    let settings = Settings(context).getInstance();

    beforeEach(() => {
        throughputController = ThroughputController(context).getInstance();
        throughputController.setConfig({
            settings,
            playbackController: new PlaybackControllerMock()
        })
        throughputController.initialize();
    });

    afterEach(() => {
        throughputController.reset();
        settings.reset();
    });

    describe('simple mean calculation', () => {

        it('should calculate the arithmetic mean', () => {
            let values = [{ value: 6 }, { value: 2 }, { value: 3 }, { value: 1 }];
            const mean = throughputController.getArithmeticMean(values, values.length);
            expect(mean).to.equal(3);
        })

        it('should calculate the byte size weighted arithmetic mean', () => {
            let values = [{ value: 10, downloadedBytes: 9 }, { value: 5, downloadedBytes: 16 }, {
                value: 20,
                downloadedBytes: 9
            }];
            const mean = throughputController.getByteSizeWeightedArithmeticMean(values, values.length);
            expect(mean).to.equal(11);
        })

        it('should calculate the date weighted arithmetic mean', () => {
            let values = [{ value: 6 }, { value: 2 }, { value: 3 }, { value: 5 }];
            const mean = throughputController.getDateWeightedArithmeticMean(values, values.length);
            expect(mean).to.equal(3.9);
        })

        it('should calculate the harmonic mean', () => {
            let values = [{ value: 6 }, { value: 2 }, { value: 3 }]
            const mean = throughputController.getHarmonicMean(values, values.length);
            expect(mean).to.equal(3);
        })

        it('should calculate byte size weighted harmonic mean', () => {
            let values = [{ value: 10, downloadedBytes: 9 }, { value: 5, downloadedBytes: 16 }, {
                value: 20,
                downloadedBytes: 9
            }];
            const mean = throughputController.getByteSizeWeightedHarmonicMean(values, values.length);
            expect(mean).to.equal(8);
        })

        it('should calculate date weighted harmonic mean', () => {
            let values = [{ value: 20 }, { value: 5 }, { value: 20 }];
            const mean = throughputController.getDateWeightedHarmonicMean(values, values.length);
            expect(Math.round(mean)).to.equal(10);
        })

        it('should calculate the ZLEMA', () => {
            let values = [{ value: 100 }, { value: 100 }, { value: 80 }, { value: 2 }, { value: 2 }, { value: 2 }];
            const mean = throughputController.getZlema(values, values.length);
            expect(Math.round(mean)).to.equal(31);
        })
    })

    describe('getAverageThroughput()', () => {

        it('Should calculate the arithmetic mean based on values from Resource Timing API', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: true,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            const result = throughputController.getAverageThroughput('video', Constants.THROUGHPUT_CALCULATION_MODES.ARITHMETIC_MEAN);

            expect(result).to.be.equal(120000);
        })

        it('Should calculate the arithmetic mean for a media type and ignore MPD throughput based on values from Resource Timing API', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: true,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            _addMpdMetric();
            const mpdThroughputs = throughputController.getRawThroughputData('stream');
            expect(mpdThroughputs).to.have.lengthOf(1);
            const result = throughputController.getAverageThroughput('video', Constants.THROUGHPUT_CALCULATION_MODES.ARITHMETIC_MEAN);

            expect(result).to.be.equal(120000);
        })

        it('Should calculate the harmonic mean based on values from Resource Timing API', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: true,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            const result = throughputController.getAverageThroughput('video', Constants.THROUGHPUT_CALCULATION_MODES.HARMONIC_MEAN);

            expect(result).to.be.equal(72000);
        })

        it('Should calculate the byte weighted arithmetic mean based on values from Resource Timing API', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: true,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            const result = throughputController.getAverageThroughput('video', Constants.THROUGHPUT_CALCULATION_MODES.BYTE_SIZE_WEIGHTED_ARITHMETIC_MEAN);

            expect(result).to.be.equal(148949);
        })

        it('Should calculate the byte weighted harmonic mean based on values from Resource Timing API', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: true,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            const result = throughputController.getAverageThroughput('video', Constants.THROUGHPUT_CALCULATION_MODES.BYTE_SIZE_WEIGHTED_HARMONIC_MEAN);

            expect(result).to.be.equal(83768);
        })

        it('Should calculate the arithmetic mean based on values from XHR traces', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: false,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            const result = throughputController.getAverageThroughput('video', Constants.THROUGHPUT_CALCULATION_MODES.ARITHMETIC_MEAN);

            // we ignore the first entry in the traces for the calculation
            expect(result).to.be.equal(122000);
        })

        it('Should calculate the harmonic mean based on values from XHR traces', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: false,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            const result = throughputController.getAverageThroughput('video', Constants.THROUGHPUT_CALCULATION_MODES.HARMONIC_MEAN);

            // we ignore the first entry in the traces for the calculation
            expect(result).to.be.equal(62609);
        })

        it('Should return raw throughput data without calculating the average', () => {
            settings.update({
                streaming: {
                    abr: {
                        throughput: {
                            useResourceTimingApi: false,
                            useNetworkInformationApi: false
                        }
                    }
                }
            })
            _addMetrics();
            const result = throughputController.getRawThroughputData('video');

            expect(result).to.have.lengthOf(3)
        })
    })

    describe('Batch startup', () => {
        // Four segments of 100 kB, all requested at t0, first byte after 600 ms, finished after 700, 800, 900 and 1000 ms
        function _addBurstMetrics(numberOfEntries = 4, responsecode = 200, mediaType = 'video', firstEntry = 0, bytes = 50000) {
            const t0 = new Date('2026-11-10T10:00:00.000Z').getTime();
            for (let i = firstEntry; i < numberOfEntries; i++) {
                eventBus.trigger(MediaPlayerEvents.METRIC_ADDED, {
                    mediaType,
                    metric: 'HttpList',
                    value: {
                        type: 'MediaSegment',
                        url: `burst-${mediaType}-${i}.m4s`,
                        trequest: new Date(t0),
                        tresponse: new Date(t0 + 600),
                        _tfinish: new Date(t0 + 700 + i * 100),
                        responsecode,
                        trace: [
                            { s: new Date(t0 + 600), d: 50, b: [bytes] },
                            { s: new Date(t0 + 650), d: 50 + i * 100, b: [bytes] }
                        ],
                        _stream: mediaType,
                        _batchStartup: { index: i, size: 4 }
                    }
                });
            }
        }

        function _setThroughputMode(throughputMode) {
            settings.update({
                streaming: {
                    batchStartup: { throughputMode },
                    abr: { throughput: { useResourceTimingApi: false, useNetworkInformationApi: false } }
                }
            });
        }

        it('should add one aggregate sample over the whole burst', () => {
            _setThroughputMode('aggregate');
            _addBurstMetrics();
            const result = throughputController.getRawThroughputData('video');

            expect(result).to.have.lengthOf(1);
            // 400 kB between first response byte (600 ms) and last finish (1000 ms)
            expect(result[0].value).to.be.equal(8000);
            expect(result[0].downloadedBytes).to.be.equal(400000);
        });

        it('should keep the bursts of video and audio apart', () => {
            _setThroughputMode('aggregate');
            _addBurstMetrics(2);
            _addBurstMetrics(4, 200, 'audio', 0, 5000);
            _addBurstMetrics(4, 200, 'video', 2);

            const video = throughputController.getRawThroughputData('video');
            const audio = throughputController.getRawThroughputData('audio');

            expect(video).to.have.lengthOf(1);
            expect(video[0].downloadedBytes).to.be.equal(400000);
            expect(audio).to.have.lengthOf(1);
            expect(audio[0].downloadedBytes).to.be.equal(40000);
        });

        it('should wait until all burst segments are loaded', () => {
            _setThroughputMode('aggregate');
            _addBurstMetrics(3);

            expect(throughputController.getAverageThroughput('video')).to.be.NaN;
        });

        it('should not count failed burst requests', () => {
            _setThroughputMode('aggregate');
            _addBurstMetrics(4, 404);

            expect(throughputController.getAverageThroughput('video')).to.be.NaN;
        });

        it('should ignore burst segments', () => {
            _setThroughputMode('ignore');
            _addBurstMetrics();

            expect(throughputController.getAverageThroughput('video')).to.be.NaN;
        });

        it('should add one sample per burst segment in raw mode', () => {
            _setThroughputMode('raw');
            _addBurstMetrics();

            expect(throughputController.getRawThroughputData('video')).to.have.lengthOf(4);
        });
    })
})
