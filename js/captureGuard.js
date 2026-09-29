// Pure guards for the camera capture: a punch must never be written from a photo that didn't
// actually get taken. No DOM access, same pattern as punchCooldown.js, so it's testable in Node.
//
// Why this exists: a <video> reports videoWidth/videoHeight as 0 until its first frame has
// decoded. A shutter tap in that window drew onto a 0x0 canvas, canvas.toBlob() returned null,
// and the punch was written anyway with no photo (28 Sep: a lunch clock-out with no photo, then
// a retry that clocked the employee back IN, inverting every later tap that day).

export const CAPTURE_WIDTH = 320;

// The canvas size to draw a frame into, or null when the video has no frame yet (dimensions 0,
// NaN or missing). The caller refuses to take the photo on null.
export function captureSize(videoWidth, videoHeight, targetWidth = CAPTURE_WIDTH){
  if(!(videoWidth > 0) || !(videoHeight > 0)) return null;
  return {width: targetWidth, height: Math.round(videoHeight * (targetWidth / videoWidth))};
}

// True only for a real, non-empty image blob. toBlob() hands back null on a 0x0 canvas or when
// the encoder fails, and an empty blob would upload as a broken photo.
export function isUsablePhoto(blob){
  return !!blob && blob.size > 0;
}
