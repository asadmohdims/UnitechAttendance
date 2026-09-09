// Supabase-backed implementation of the store interface, used when DEMO_MODE is false.
import { sb } from '../supabaseClient.js';
import { dateStr } from '../utils.js';

async function listEmployees(){
  const {data, error} = await sb.from('employees').select('*').order('created_at');
  if(error) throw error;
  return data;
}

async function listOpenSessions(){
  const {data, error} = await sb.from('records').select('*').is('clock_out', null);
  if(error) throw error;
  const openSessions = {};
  data.forEach(r => openSessions[r.emp_id] = r);
  return openSessions;
}

async function addEmployee(name){
  const {data, error} = await sb.from('employees').insert({name}).select().single();
  if(error) throw error;
  return data;
}

async function renameEmployee(id, name){
  const {error} = await sb.from('employees').update({name}).eq('id', id);
  if(error) throw error;
}

async function setEmployeeActive(id, active){
  const {error} = await sb.from('employees').update({active}).eq('id', id);
  if(error) throw error;
}

async function setEmployeeAvatar(id, path){
  const {error} = await sb.from('employees').update({avatar:path}).eq('id', id);
  if(error) throw error;
}

async function clockIn(empId, photoPath){
  const {data, error} = await sb.from('records')
    .insert({emp_id:empId, date:dateStr(), clock_in:new Date().toISOString(), in_photo:photoPath})
    .select().single();
  if(error) throw error;
  return data;
}

async function clockOut(recordId, photoPath){
  const {error} = await sb.from('records')
    .update({clock_out:new Date().toISOString(), out_photo:photoPath})
    .eq('id', recordId);
  if(error) throw error;
}

async function listRecordsForDate(date){
  const {data, error} = await sb.from('records').select('*').eq('date', date).order('clock_in');
  if(error) throw error;
  return data;
}

async function listRecordsForRange(startDate, endDate){
  const {data, error} = await sb.from('records').select('*').gte('date', startDate).lte('date', endDate);
  if(error) throw error;
  return data;
}

async function updateRecordTimes(recordId, clockInIso, clockOutIsoOrNull){
  const {error} = await sb.from('records')
    .update({clock_in:clockInIso, clock_out:clockOutIsoOrNull})
    .eq('id', recordId);
  if(error) throw error;
}

async function deleteRecord(record){
  const {error} = await sb.from('records').delete().eq('id', record.id);
  if(error) throw error;
  sb.storage.from('photos').remove([record.in_photo, record.out_photo].filter(Boolean));
}

async function uploadPhoto(path, blob, {upsert = false} = {}){
  const {error} = await sb.storage.from('photos').upload(path, blob, {contentType:'image/jpeg', upsert});
  if(error) throw error;
}

async function getPhotoUrl(path){
  if(!path) return null;
  const {data} = await sb.storage.from('photos').createSignedUrl(path, 3600);
  return data ? data.signedUrl : null;
}

export const supabaseStore = {
  listEmployees, addEmployee, renameEmployee, setEmployeeActive, setEmployeeAvatar,
  listOpenSessions, clockIn, clockOut,
  listRecordsForDate, listRecordsForRange, updateRecordTimes, deleteRecord,
  uploadPhoto, getPhotoUrl
};
