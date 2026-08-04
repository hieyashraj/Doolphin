import { ModelRegistry } from '../registry/ModelRegistry.js';

export class WorkflowEngine {
  /**
   * Generates a dynamic workflow stage graph based on generation type, preset, model, and asset configuration.
   */
  static generateStageGraph({ generationType, presetId, selectedModelId, assetRoles = [], requiresSpeech = true, appCompositingMode = 'pip' }) {
    const modelEntry = ModelRegistry.find(m => m.id === selectedModelId);
    const stages = [];
    let order = 1;

    // Stage 1: Validation
    stages.push({
      order: order++,
      name: 'validate_request',
      status: 'pending',
      message: 'Checking request parameters and asset checksums'
    });

    // Stage 2: Asset Normalization
    stages.push({
      order: order++,
      name: 'normalize_assets',
      status: 'pending',
      message: 'Normalizing and inspecting source asset formats'
    });

    if (generationType === 'product_ad') {
      // Stage 3: Product Analysis
      stages.push({
        order: order++,
        name: 'analyze_product',
        status: 'pending',
        message: 'Analyzing product geometry, logo visibility, and packaging'
      });

      // Stage 4: Base Video Generation
      stages.push({
        order: order++,
        name: 'generate_base_video',
        status: 'pending',
        message: `Dispatching video generation to ${modelEntry?.displayName || 'selected model'}`
      });

      // Stage 5: Audio Dialogue (Conditional)
      if (requiresSpeech) {
        if (modelEntry?.nativeAudio && (modelEntry?.nativeDialogue || modelEntry?.scriptedDialogue)) {
          stages.push({
            order: order++,
            name: 'native_speech_synthesis',
            status: 'pending',
            message: 'Synthesizing native actor dialogue stream'
          });
        } else {
          stages.push({
            order: order++,
            name: 'elevenlabs_tts_generation',
            status: 'pending',
            message: 'Generating ElevenLabs creator voiceover track'
          });

          if (modelEntry?.lipSyncRequirement === 'external_adapter') {
            stages.push({
              order: order++,
              name: 'external_lip_sync',
              status: 'pending',
              message: 'Synchronizing actor lip movement to spoken dialogue'
            });
          }
        }
      }
    } else if (generationType === 'app_studio') {
      // Stage 3: App Canvas Layout & Screen Identification
      stages.push({
        order: order++,
        name: 'prepare_app_canvas',
        status: 'pending',
        message: `Configuring ${appCompositingMode} device frame layout`
      });

      // Stage 4: Voiceover (Conditional)
      if (requiresSpeech) {
        stages.push({
          order: order++,
          name: 'elevenlabs_tts_generation',
          status: 'pending',
          message: 'Generating ElevenLabs app walkthrough voiceover'
        });
      }

      // Stage 5: Presenter Video Generation (Only if PiP or Split Screen)
      if (appCompositingMode === 'pip' || appCompositingMode === 'side_by_side') {
        stages.push({
          order: order++,
          name: 'generate_presenter_video',
          status: 'pending',
          message: 'Generating creator reaction video stream'
        });
      }

      // Stage 6: Deterministic App Compositing (FFmpeg + Sharp)
      stages.push({
        order: order++,
        name: 'composite_app_recording',
        status: 'pending',
        message: 'Compositing real app screen pixels onto device canvas'
      });
    }

    // Final Stages: Captions, Final Assembly, Storage & Delivery Validation
    stages.push({
      order: order++,
      name: 'burn_captions_and_overlays',
      status: 'pending',
      message: 'Rendering subtitle captions and brand CTA overlay'
    });

    stages.push({
      order: order++,
      name: 'save_and_verify_delivery',
      status: 'pending',
      message: 'Verifying final MP4 playback, storage, and download URL'
    });

    return stages;
  }
}
