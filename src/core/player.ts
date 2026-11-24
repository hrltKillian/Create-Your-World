/** Player constants shared by the simulation, the camera, the audio and the input layer. */

/** Eye height above the feet (m), standing and crouching. */
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.27;

/** Hotbar slots (InputCommand.slot is 0…HOTBAR_SLOTS−1). */
export const HOTBAR_SLOTS = 8;

/**
 * Ground covered by one step (m; 2.5 steps a second at walking speed): a footstep sounds and the
 * view bob dips once a stride.
 */
export const STRIDE = 1.7;
