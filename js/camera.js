import { $, busy } from './utils.js';
import { state } from './state.js';

let stream = null;

export function stopCam(){
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('camModal').classList.remove('open');
}

// mode: 'punch' | 'avatar'. `onCapture(blob)` does the store work for the captured photo.
// If it throws, the modal stays open with an inline error and the capture button re-enabled
// for a retry — matching the original single combined handler's behavior.
export async function captureFor(emp, mode, onCapture){
  const open = state.openSessions[emp.id];
  if(mode === 'avatar'){
    $('camTitle').textContent = `Take ${emp.name}'s photo`;
    document.querySelector('.camera-help').textContent = 'Look at the camera, then take a clear photo for their profile.';
    $('btnCamCancel').textContent = 'Skip for now';
  }else{
    $('camTitle').textContent = open ? `Finish work, ${emp.name}?` : `Start work, ${emp.name}?`;
    document.querySelector('.camera-help').textContent = open
      ? 'Look at the camera, then take your photo to finish work.'
      : 'Look at the camera, then take your photo to start work.';
    $('btnCamCancel').textContent = 'Cancel';
  }
  $('camError').textContent = '';
  $('camModal').classList.add('open');
  $('btnCapture').disabled = true;
  $('btnCamCancel').onclick = stopCam;
  $('btnCapture').onclick = async () => {
    if(!stream) return;
    const video = $('video');
    const c = document.createElement('canvas');
    const scale = 320 / video.videoWidth;
    c.width = 320; c.height = Math.round(video.videoHeight * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.7));
    $('btnCapture').disabled = true;
    busy(true);
    try{
      await onCapture(blob);
      stopCam();
    }catch(err){
      $('camError').textContent = 'Failed: ' + err.message + ' — check internet and try again.';
      $('btnCapture').disabled = false;
    }
    busy(false);
  };

  try{
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user', width:{ideal:640}}, audio:false});
    $('video').srcObject = stream;
    $('btnCapture').disabled = false;
  }catch(err){
    $('camError').textContent = 'Camera unavailable: ' + err.message;
  }
}
