// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { Messenger, Utils } from "@amazon-sumerian-hosts/babylon";
import pako from "pako";

/**
 * The AWS LexRuntime service object.
 * @external LexRuntime
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/LexRuntime.html
 */

/**
 * Feature class for interacting with Lex V2 chatbots.
 *
 * @property {Object} EVENTS - Built-in messages that the feature emits.
 * @property {string} [EVENTS.lexResponseReady=lexResponseReady] - Message that is emitted after
 * receiving lex response for the input sent
 * @property {string} [EVENTS.micReady=micReady] - Message that is emitted after
 * microphone is ready to use
 * @property {string} [EVENTS.recordBegin=recordBegin] - Message that is emitted after
 * microphone starts recording
 * @property {string} [EVENTS.recordEnd=recordEnd] - Message that is emitted after
 * microphone ends recording
 */
class LexV2Feature extends Messenger {
  /**
   * @constructor
   *
   * @param {external:LexRuntime} lexRuntime - A AWS.LexRuntimeV2 instance to use
   * @param {Object=} options - Options that determine which Lex bot will be used.
   * @param {string=} options.botId - The ID of the Lex bot to use. Example: "KPJPZUHJU1"
   *     Note this is *not* the same as the bot's "name".
   * @param {string=} options.botAliasId - The ID of the Lex bot alias to use. Example: "KTSJZJZJ1E"
   *     Note this is *not* the same as the alias's "name".
   * @param {string=} options.localeId - (Optional) The locale ID of the language to use. If you do
   *     not provide this value, a default of "en_US" will be used.
   * @param {string=} options.sessionId - (Optional) A unique identifier for the session. If you do
   *     not provide this value a unique session ID will be used automatically.
   */
  constructor(
    lexRuntime,
    options = {
      botId: undefined,
      botAliasId: undefined,
      localeId: "en_US",
      sessionId: undefined,
    }
  ) {
    super();

    if (!lexRuntime) {
      throw Error(
        "Failed to initialize LexV2Feature.The lexRuntime parameter is required"
      );
    }
    if (lexRuntime.config) {
      lexRuntime.config.customUserAgent = Utils.addCoreUserAgentComponent(
        lexRuntime.config.customUserAgent
      );
      lexRuntime.config.customUserAgent = Utils.addStringOnlyOnce(
        lexRuntime.config.customUserAgent,
        this.getEngineUserAgentString()
      );
    }
    this._lexRuntime = lexRuntime;

    this._options = {
      botId: options.botId,
      botAliasId: options.botAliasId,
      localeId: options.localeId || "en_US",
      sessionId: options.sessionId || Utils.createId(),
    };

    //Microphone related fields
    this._micReady = false;
    this._recording = false;
    this._recLength = 0;
    this._recBuffer = [];
    this._setupAudioContext();
  }

  /**
   * Setup audio context which will be used for setting up microphone related audio node
   */
  _setupAudioContext() {
    this._audioContext = new AudioContext();
  }

  /**
   * Sends audio input to Amazon Lex.
   *
   * @param {TypedArray} inputAudio - TypedArray view of the input audio buffer
   * @param {Number} sourceSampleRate - Sample rate of the input audio
   * @param {Object=} config - Optional config for overriding lex bot info
   * @param {string=} config.botName - The name of the lex bot.
   * @param {string=} config.botAlias - The alias of the lex bot.
   * @param {string=} config.userId - The userId used to keep track of the session with lex bot.
   *
   * @returns {Promise} A Promise-like object that resolves to a Lex response object.
   * For details on the structure of that response object see: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/LexRuntime.html#postContent-property
   */
  _processWithAudio(inputAudio, sourceSampleRate, config = {}) {
    const audio = this._prepareAudio(inputAudio, sourceSampleRate);
    return this._process("audio/x-l16; rate=16000", audio, config);
  }

  /**
   * Sends text user input to Amazon Lex.
   *
   * @returns {Promise} A Promise-like object that resolves to a Lex response object.
   * For details on the structure of that response object see: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/LexRuntime.html#postContent-property
   */
  processWithText(inputText) {
    return this._process("text/plain; charset=utf-8", inputText);
  }

  _process(contentType, inputStream) {
    const params = {
      ...this._options,
      requestContentType: contentType,
      responseContentType: "text/plain;charset=utf-8",
      inputStream,
    };

    return new Promise((resolve, reject) => {
      this._lexRuntime.recognizeUtterance(params, (error, data) => {
        if (error) {
          return reject(error);
        }
        return resolve(data);
      });
    })
      .then((response) => {
        const decodedResponse = decodeResponse(response);
        this.emit(this.constructor.EVENTS.lexResponseReady, decodedResponse);
        return response;
      })
      .catch((error) => {
        const errorMessage = `Error happened during voice recording: ${error}. Please check whether your speech is more than 15s.`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      });
  }

  _prepareAudio(audioBuffer, sourceSampleRate) {
    const downsampledAudio = LexUtils.downsampleAudio(
      audioBuffer,
      sourceSampleRate,
      this.constructor.LEX_DEFAULTS.SampleRate
    );
    const encodedAudio = LexUtils.encodeWAV(
      downsampledAudio,
      this.constructor.LEX_DEFAULTS.SampleRate
    );

    return new Blob([encodedAudio], { type: "application/octet-stream" });
  }

  /**
   * Async function to setup microphone recorder which will get user permission for accessing microphone
   * This method must be called before attempting to record voice input with the
   * beginVoiceRecording() method. Expect an error to be thrown if the user has
   * chosen to block microphone access.
   *
   * @throws {DOMException} See the documentation for
   * [MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
   * The most likely error to expect will be the "NotAllowed" error indicating
   * the user has denied access to the microphone.
   */
  async enableMicInput() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    const source = this._audioContext.createMediaStreamSource(stream);
    //TODO: createScriptProcessor is deprecated which should be replaced
    const node = this._audioContext.createScriptProcessor(4096, 1, 1);

    node.onaudioprocess = (e) => {
      if (!this._recording) return;

      const buffer = e.inputBuffer.getChannelData(0);
      this._recBuffer.push(new Float32Array(buffer));
      this._recLength += buffer.length;
    };

    source.connect(node);
    node.connect(this._audioContext.destination);

    this.emit(this.constructor.EVENTS.micReady);
    this._micReady = true;
  }

  /**
   * Begin microphone recording. This function will also try to resume audioContext so that
   * it's suggested to call this function after a user interaction
   */
  beginVoiceRecording() {
    if (!this._micReady) {
      return;
    }

    if (
      this._audioContext.state === "suspended" ||
      this._audioContext.state === "interrupted"
    ) {
      this._audioContext.resume();
    }
    this._recLength = 0;
    this._recBuffer = [];
    this._recording = true;

    this.emit(this.constructor.EVENTS.recordBegin);
  }

  /**
   * Stop microphone recording and send recorded audio data to lex.
   *
   * @returns {Promise} A Promise-like object that resolves to a Lex response object.
   * For details on the structure of that response object see: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/LexRuntime.html#postContent-property
   */
  endVoiceRecording() {
    if (!this._recording) {
      return Promise.resolve();
    }

    this._recording = false;

    const result = new Float32Array(this._recLength);
    let offset = 0;
    for (let i = 0; i < this._recBuffer.length; i++) {
      result.set(this._recBuffer[i], offset);
      offset += this._recBuffer[i].length;
    }

    this.emit(this.constructor.EVENTS.recordEnd);
    return this._processWithAudio(result, this._audioContext.sampleRate);
  }

  /**
   *
   * @returns The useragent string for the engine you are using, e.g. 'babylonjs/5.1.0'
   */
  getEngineUserAgentString() {
    return "UnknownEngine";
  }
}

Object.defineProperties(LexV2Feature, {
  LEX_DEFAULTS: {
    value: {
      SampleRate: "16000",
    },
    writable: false,
  },
  EVENTS: {
    value: {
      ...Object.getPrototypeOf(LexV2Feature).EVENTS,
      lexResponseReady: "lexResponseReady",
      micReady: "micReady",
      recordBegin: "recordBegin",
      recordEnd: "recordEnd",
    },
  },
});

/**
 * Returns a copy of the Lex response, decoding any compressed values. The
 * original response object is not modified.
 */
function decodeResponse(lexResponse) {
  const decodedResponse = { ...lexResponse };

  decodedResponse.sessionState = decodeAndUnzipJsonString(
    lexResponse.sessionState
  );

  if (lexResponse.inputTranscript) {
    decodedResponse.inputTranscript = decodeAndUnzipJsonString(
      lexResponse.inputTranscript
    );
  }

  if (lexResponse.messages) {
    decodedResponse.messages = decodeAndUnzipJsonString(lexResponse.messages);
  }

  return decodedResponse;
}

/**
 * Accepts a base64-encoded, gzip-compressed JSON string and returns
 * a parsed JSON object.
 */
function decodeAndUnzipJsonString(encodedString) {
  if (encodedString === undefined) return undefined;

  const data = atob(encodedString);
  const gzipedDataArray = Uint8Array.from(data, (c) => c.charCodeAt(0));
  const unzippedJsonString = pako.inflate(gzipedDataArray, { to: "string" });
  const result = JSON.parse(unzippedJsonString);
  return result;
}

/**
 * A collection of useful lex related functions.
 */
class LexUtils {
  /**
   * Downsamples the audio to a target sample rate.
   *
   * Inspired by the following blog post from the Lex team:
   * https://aws.amazon.com/blogs/machine-learning/capturing-voice-input-in-a-browser/
   *
   * @param {Float32Array} buffer - Input audio buffer
   * @param {float} sourceSampleRate - Sample rate of the input audio buffer
   * @param {float} targetSampleRate - Sample rate to try to convert to
   *
   * @return {Float32Array} Downsampled audio buffer
   */
  static downsampleAudio(buffer, sourceSampleRate, targetSampleRate) {
    if (!buffer || !buffer.length) {
      return;
    }

    if (sourceSampleRate === targetSampleRate) {
      return buffer;
    }

    if (sourceSampleRate < targetSampleRate) {
      throw Error(
        `Input Sample rate ${sourceSampleRate} is less than target sample rate ${targetSampleRate}.`
      );
    }

    const bufferLength = buffer.length;
    const sampleRateRatio = sourceSampleRate / targetSampleRate;
    const newLength = Math.round(bufferLength / sampleRateRatio);

    const downsampledBuffer = new Float32Array(newLength);

    let position = 0;
    let bufferOffset = 0;
    while (position < newLength) {
      const nextBufferOffset = Math.round((position + 1) * sampleRateRatio);

      let accumulator = 0;
      let count = 0;
      for (
        let i = bufferOffset;
        i < nextBufferOffset && i < bufferLength;
        i++
      ) {
        accumulator += buffer[i];
        count++;
      }

      downsampledBuffer[position] = accumulator / count;
      position++;
      bufferOffset = nextBufferOffset;
    }

    return downsampledBuffer;
  }

  /**
   * Converts audio data to WAV.
   *
   * Inspired by the following blog post from the Lex team:
   * https://aws.amazon.com/blogs/machine-learning/capturing-voice-input-in-a-browser/
   *
   * @param {Float32Array} buffer - Input audio buffer
   * @param {float} targetSampleRate - Sample rate for the output audio
   *
   * @return {DataView} Converted audio data
   */
  static encodeWAV(buffer, targetSampleRate) {
    function _writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
    function _floatTo16BitPCM(view, offset, input) {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
    }

    if (!buffer) {
      return;
    }

    //Insert WAV format related info at the beginning of the buffer up to offset 44
    const encodedBuffer = new ArrayBuffer(44 + buffer.length * 2);
    const view = new DataView(encodedBuffer);

    _writeString(view, 0, "RIFF");
    view.setUint32(4, 32 + buffer.length * 2, true);
    _writeString(view, 8, "WAVE");
    _writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetSampleRate, true);
    view.setUint32(28, targetSampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    _writeString(view, 36, "data");
    view.setUint32(40, buffer.length * 2, true);
    _floatTo16BitPCM(view, 44, buffer);

    return view;
  }
}

export default LexV2Feature;
export { LexV2Feature };
