// --- File: requests.js (Module) ---
// ផ្ទុកនូវរាល់ Logic សម្រាប់ Firestore, Telegram, និង Geolocation

import { doc, setDoc, updateDoc, deleteDoc, getDoc, collection, query, where, onSnapshot, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import * as Utils from './utils.js';

// --- Module-level State & Constants ---
let leaveRequestsCollectionPath = '';
let outRequestsCollectionPath = '';
let currentReturnRequestId = null; // ប្រើសម្រាប់ Return Scan

export const SHEET_ID = '1_Kgl8UQXRsVATt_BOHYQjVWYKkRIBA12R-qnsBoSUzc';
export const SHEET_NAME = 'បញ្ជឺឈ្មោះរួម';
export const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}&tq=${encodeURIComponent('SELECT E, L, AA, N, G, S WHERE E IS NOT NULL OFFSET 0')}`;

const BOT_TOKEN = '8284240201:AAEDRGHDcuoQAhkWk7km6I-9csZNbReOPHw';
const CHAT_ID = '1487065922';

export const allowedAreaCoords = [ [11.417052769150015, 104.76508285291308], [11.417130005964497, 104.76457396198742], [11.413876386899489, 104.76320488118378], [11.41373800267192, 104.76361527709159] ];
export const LOCATION_FAILURE_MESSAGE = "ការបញ្ជាក់ចូលមកវិញ បរាជ័យ។ \n\nប្រហែលទូរស័ព្ទអ្នកមានបញ្ហា ការកំណត់បើ Live Location ដូច្នោះអ្នកមានជម្រើសមួយទៀតគឺអ្នកអាចទៅបញ្ជាក់ដោយផ្ទាល់នៅការិយាល័យអគារ B ជាមួយក្រុមការងារលោកគ្រូ ដារ៉ូ។";

/**
 * កំណត់ Collection Paths ពី app.js
 */
export function setCollectionPaths(leavePath, outPath) {
    leaveRequestsCollectionPath = leavePath;
    outRequestsCollectionPath = outPath;
}

/**
 * ផ្ញើ Telegram Notification
 */
export async function sendTelegramNotification(message) { 
    console.log("Sending Telegram notification..."); 
    try { 
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`; 
        const res = await fetch(url, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' }) 
        }); 
        if (!res.ok) { 
            const errBody = await res.text(); 
            console.error("Telegram API error:", res.status, errBody); 
        } else { 
            console.log("Telegram notification sent successfully."); 
        } 
    } catch (e) { 
        console.error("Failed to send Telegram message:", e); 
    } 
}

// --- SUBMIT LOGIC ---

/**
 * បញ្ជូនសំណើច្បាប់ឈប់សម្រាក (Leave Request)
 */
export async function submitLeaveRequest(db, auth, currentUser, data, dates, elements, helpers) {
    const { duration, reason } = data;
    const { singleDate, startDate, endDate } = dates;
    const { errorEl, loadingEl, submitBtn } = elements;
    const { singleDayDurations, navigateTo, showCustomAlert } = helpers;

    if (!currentUser || !currentUser.id) return showCustomAlert("Error", "មានបញ្ហា៖ មិនអាចបញ្ជាក់អ្នកប្រើប្រាស់បានទេ។"); 
    if (!duration) { 
        if (errorEl) { errorEl.textContent = 'សូមជ្រើសរើស "រយៈពេល" ឲ្យបានត្រឹមត្រូវ (ពីក្នុងបញ្ជី)។'; errorEl.classList.remove('hidden'); } 
        return; 
    } 
    if (!reason || reason.trim() === '') { 
        if (errorEl) { errorEl.textContent = 'សូមបំពេញ "មូលហេតុ" ជាមុនសិន។'; errorEl.classList.remove('hidden'); } 
        return; 
    } 
    
    if (errorEl) errorEl.classList.add('hidden'); 
    if (loadingEl) loadingEl.classList.remove('hidden'); 
    if (submitBtn) submitBtn.disabled = true; 
    
    try { 
        const isSingleDay = singleDayDurations.includes(duration);
        const startDateInputVal = isSingleDay ? singleDate : Utils.formatInputDateToDb(startDate);
        const endDateInputVal = isSingleDay ? startDateInputVal : Utils.formatInputDateToDb(endDate);
        
        if (new Date(Utils.formatDbDateToInput(endDateInputVal)) < new Date(Utils.formatDbDateToInput(startDateInputVal))) { 
            throw new Error('"ថ្ងៃបញ្ចប់" មិនអាចនៅមុន "ថ្ងៃចាប់ផ្តើម" បានទេ។'); 
        } 
        
        const requestId = `leave_${Date.now()}`; 
        const requestData = { 
            userId: currentUser.id, 
            name: currentUser.name, 
            department: currentUser.department || 'N/A', 
            photo: currentUser.photo || null, 
            duration: duration, 
            reason: reason.trim(), 
            startDate: Utils.formatDateToDdMmmYyyy(startDateInputVal), 
            endDate: Utils.formatDateToDdMmmYyyy(endDateInputVal), 
            status: 'pending', 
            requestedAt: serverTimestamp(), 
            requestId: requestId, 
            firestoreUserId: auth.currentUser ? auth.currentUser.uid : 'unknown_auth_user' 
        }; 
        
        if (!db || !leaveRequestsCollectionPath) throw new Error("Firestore DB or Collection Path is not initialized."); 
        const requestRef = doc(db, leaveRequestsCollectionPath, requestId); 
        await setDoc(requestRef, requestData); 
        
        console.log("Firestore (leave) write successful."); 
        const dateString = (startDateInputVal === endDateInputVal) ? startDateInputVal : `ពី ${startDateInputVal} ដល់ ${endDateInputVal}`; 
        let message = `<b>🔔 សំណើសុំច្បាប់ឈប់សម្រាក 🔔</b>\n\n`; 
        message += `<b>ឈ្មោះ:</b> ${requestData.name} (${requestData.userId})\n`; 
        message += `<b>ផ្នែក:</b> ${requestData.department}\n`; 
        message += `<b>រយៈពេល:</b> ${requestData.duration}\n`; 
        message += `<b>កាលបរិច្ឆេទ:</b> ${dateString}\n`; 
        message += `<b>មូលហេតុ:</b> ${requestData.reason}\n\n`; 
        message += `(សូមចូល Firestore ដើម្បីពិនិត្យ ID: \`${requestId}\`)`; 
        await sendTelegramNotification(message); 
        
        if (loadingEl) loadingEl.classList.add('hidden'); 
        showCustomAlert('ជោគជ័យ!', 'សំណើរបស់អ្នកត្រូវបានផ្ញើដោយជោគជ័យ!', 'success'); 
        navigateTo('page-history'); 
    } catch (error) { 
        console.error("Error submitting leave request:", error); 
        let displayError = error.message; 
        if (error.code?.includes('permission-denied')) displayError = 'Missing or insufficient permissions. សូមពិនិត្យ Firestore Rules។'; 
        if (errorEl) { errorEl.textContent = `Error: ${displayError}`; errorEl.classList.remove('hidden'); } 
        if (loadingEl) loadingEl.classList.add('hidden'); 
        if (submitBtn) submitBtn.disabled = false; 
    }
}

/**
 * បញ្ជូនសំណើច្បាប់ចេញក្រៅ (Out Request)
 */
export async function submitOutRequest(db, auth, currentUser, data, dates, elements, helpers) {
    const { duration, reason } = data;
    const { date } = dates;
    const { errorEl, loadingEl, submitBtn } = elements;
    const { navigateTo, showCustomAlert } = helpers;

    if (!currentUser || !currentUser.id) return showCustomAlert("Error", "មានបញ្ហា៖ មិនអាចបញ្ជាក់អ្នកប្រើប្រាស់បានទេ។"); 
    if (!duration) { 
        if (errorEl) { errorEl.textContent = 'សូមជ្រើសរើស "រយៈពេល" ឲ្យបានត្រឹមត្រូវ (ពីក្នុងបញ្ជី)។'; errorEl.classList.remove('hidden'); } 
        return; 
    } 
    if (!reason || reason.trim() === '') { 
        if (errorEl) { errorEl.textContent = 'សូមបំពេញ "មូលហេតុ" ជាមុនសិន។'; errorEl.classList.remove('hidden'); } 
        return; 
    } 
    
    if (errorEl) errorEl.classList.add('hidden'); 
    if (loadingEl) loadingEl.classList.remove('hidden'); 
    if (submitBtn) submitBtn.disabled = true; 
    
    try { 
        const dateVal = date ? date : Utils.getTodayString('dd/mm/yyyy'); 
        const requestId = `out_${Date.now()}`; 
        const requestData = { 
            userId: currentUser.id, 
            name: currentUser.name, 
            department: currentUser.department || 'N/A', 
            photo: currentUser.photo || null, 
            duration: duration, 
            reason: reason.trim(), 
            startDate: Utils.formatDateToDdMmmYyyy(dateVal), 
            endDate: Utils.formatDateToDdMmmYyyy(dateVal), 
            status: 'pending', 
            requestedAt: serverTimestamp(), 
            requestId: requestId, 
            firestoreUserId: auth.currentUser ? auth.currentUser.uid : 'unknown_auth_user', 
            returnStatus: 'N/A' 
        }; 
        
        if (!db || !outRequestsCollectionPath) throw new Error("Firestore DB or Out Collection Path is not initialized."); 
        const requestRef = doc(db, outRequestsCollectionPath, requestId); 
        await setDoc(requestRef, requestData); 
        
        console.log("Firestore (out) write successful."); 
        let message = `<b>🔔 សំណើសុំច្បាប់ចេញក្រៅ 🔔</b>\n\n`; 
        message += `<b>ឈ្មោះ:</b> ${requestData.name} (${requestData.userId})\n`; 
        message += `<b>ផ្នែក:</b> ${requestData.department}\n`; 
        message += `<b>រយៈពេល:</b> ${requestData.duration}\n`; 
        message += `<b>កាលបរិច្ឆេទ:</b> ${requestData.startDate}\n`; 
        message += `<b>មូលហេតុ:</b> ${requestData.reason}\n\n`; 
        message += `(សូមចូល Firestore ដើម្បីពិនិត្យ ID: \`${requestId}\`)`; 
        await sendTelegramNotification(message); 
        
        if (loadingEl) loadingEl.classList.add('hidden'); 
        showCustomAlert('ជោគជ័យ!', 'សំណើរបស់អ្នកត្រូវបានផ្ញើដោយជោគជ័យ!', 'success'); 
        navigateTo('page-history'); 
    } catch (error) { 
        console.error("Error submitting out request:", error); 
        let displayError = error.message; 
        if (error.code?.includes('permission-denied')) displayError = 'Missing or insufficient permissions. សូមពិនិត្យ Firestore Rules។'; 
        if (errorEl) { errorEl.textContent = `Error: ${displayError}`; errorEl.classList.remove('hidden'); } 
        if (loadingEl) loadingEl.classList.add('hidden'); 
        if (submitBtn) submitBtn.disabled = false; 
    }
}

// --- HISTORY & RENDERING LOGIC ---

function getSortPriority(status) { 
    switch(status) { 
        case 'pending': return 1; 
        case 'editing': return 2; 
        case 'approved': return 3; 
        case 'rejected': return 4; 
        default: return 5; 
    } 
}

/**
 * បង្ហាញ History List នៅក្នុង UI
 */
function renderHistoryList(snapshot, container, placeholder, type, elements, alertHelpers) {
    if (!container || !placeholder) return;
    const requests = []; 
    alertHelpers.clear(); // Clear all pending timers

    if (snapshot.empty) {
        placeholder.classList.remove('hidden');
        container.innerHTML = '';
    } else {
        placeholder.classList.add('hidden');
        container.innerHTML = '';
        snapshot.forEach(doc => requests.push(doc.data()));
        requests.sort((a, b) => {
            const priorityA = getSortPriority(a.status);
            const priorityB = getSortPriority(b.status);
            if (priorityA !== priorityB) return priorityA - priorityB;
            const timeA = a.requestedAt?.toMillis() ?? 0;
            const timeB = b.requestedAt?.toMillis() ?? 0;
            return timeB - timeA;
        });

        // --- Pending Alert Logic ---
        if (requests.length > 0) {
            const topRequest = requests[0];
            if (topRequest.status === 'pending') {
                const requestedAtTime = topRequest.requestedAt?.toMillis();
                if (requestedAtTime) {
                    const now = Date.now();
                    const pendingDurationSec = (now - requestedAtTime) / 1000;
                    console.log(`Top request is pending for ${pendingDurationSec.toFixed(0)} seconds.`);

                    // 1. Timer 20s
                    if (pendingDurationSec < 20) {
                        const timeTo20s = (20 - pendingDurationSec) * 1000;
                        setTimeout(() => {
                            const historyPage = document.getElementById('page-history');
                            if (alertHelpers.isEditing) return console.log("20s Timer: Canceled (User is editing).");
                            if (historyPage && historyPage.classList.contains('hidden')) return console.log("20s Timer: Canceled (Not on history page).");
                            alertHelpers.show("សំណើររបស់អ្នកមានការយឺតយ៉ាវបន្តិចប្រហែល Admin ជាប់រវល់ការងារច្រើន ឬសំណើររបស់អ្នកមានបញ្ហាខុសលក្ខខ័ណ្ឌអ្វីមួយ!");
                        }, timeTo20s);
                    }
                    // 2. Timer 50s
                    if (pendingDurationSec < 50) {
                        const timeTo50s = (50 - pendingDurationSec) * 1000;
                        setTimeout(() => {
                            const historyPage = document.getElementById('page-history');
                            if (alertHelpers.isEditing) return console.log("50s Timer: Canceled (User is editing).");
                            if (historyPage && historyPage.classList.contains('hidden')) return console.log("50s Timer: Canceled (Not on history page).");
                            alertHelpers.show("សូមរង់ចាំបន្តិច! ប្រព័ន្ធនិងផ្ដល់សារស្វ័យប្រវត្តិរលឹកដល់ Admin ពីសំណើររបស់អ្នក!");
                            let reminderMsg = `<b>🔔 REMINDER (50s) 🔔</b>\n\nRequest <b>(ID: ${topRequest.requestId})</b> from <b>${topRequest.name}</b> is still pending.`;
                            sendTelegramNotification(reminderMsg);
                        }, timeTo50s);
                    }
                    // 3. Timer 120s
                    if (pendingDurationSec < 120) {
                        const timeTo120s = (120 - pendingDurationSec) * 1000;
                        setTimeout(() => {
                            const historyPage = document.getElementById('page-history');
                            if (alertHelpers.isEditing) return console.log("120s Timer: Canceled (User is editing).");
                            if (historyPage && historyPage.classList.contains('hidden')) return console.log("120s Timer: Canceled (Not on history page).");
                            alertHelpers.show("សូមរង់ចាំបន្តិច! ប្រព័ន្ធនិងផ្ដល់សារស្វ័យប្រវត្តិរលឹកដល់ Admin ពីសំណើររបស់អ្នក!");
                            let reminderMsg = `<b>🔔 SECOND REMINDER (2min) 🔔</b>\n\nRequest <b>(ID: ${topRequest.requestId})</b> from <b>${topRequest.name}</b> has been pending for 2 minutes. Please check.`;
                            sendTelegramNotification(reminderMsg);
                        }, timeTo120s);
                    }
                }
            }
        }
        // --- End Pending Alert Logic ---

        requests.forEach(request => container.innerHTML += renderHistoryCard(request, type));
    }

    // Update button states
    if (type === 'leave') {
        const hasPendingLeave = !snapshot.empty && (requests[0].status === 'pending' || requests[0].status === 'editing');
        updateLeaveButtonState(elements.leaveButton, hasPendingLeave);
    } else if (type === 'out') {
        let hasActiveOut = false;
        if (!snapshot.empty) {
            if (requests[0].status === 'pending' || requests[0].status === 'editing') {
                hasActiveOut = true;
            } else {
                hasActiveOut = requests.some(r => r.status === 'approved' && r.returnStatus !== 'បានចូលមកវិញ');
            }
        }
        updateOutButtonState(elements.outButton, hasActiveOut);
    }
}

/**
 * បង្កើត HTML សម្រាប់ History Card មួយ
 */
function renderHistoryCard(request, type) { 
    if (!request || !request.requestId) return ''; 
    let statusColor, statusText, decisionInfo = ''; 
    switch(request.status) { 
        case 'approved': statusColor = 'bg-green-100 text-green-800'; statusText = 'បានយល់ព្រម'; if (request.decisionAt) decisionInfo = `<p class="text-xs text-green-600 mt-1">នៅម៉ោង: ${Utils.formatFirestoreTimestamp(request.decisionAt, 'time')}</p>`; break; 
        case 'rejected': statusColor = 'bg-red-100 text-red-800'; statusText = 'បានបដិសធ'; if (request.decisionAt) decisionInfo = `<p class="text-xs text-red-600 mt-1">នៅម៉ោង: ${Utils.formatFirestoreTimestamp(request.decisionAt, 'time')}</p>`; break; 
        case 'editing': statusColor = 'bg-blue-100 text-blue-800'; statusText = 'កំពុងកែសម្រួល'; break; 
        default: statusColor = 'bg-yellow-100 text-yellow-800'; statusText = 'កំពុងរង់ចាំ'; 
    } 
    const dateString = (request.startDate === request.endDate) ? request.startDate : (request.startDate && request.endDate ? `${request.startDate} ដល់ ${request.endDate}` : 'N/A'); 
    const showActions = (request.status === 'pending' || request.status === 'editing'); 
    let returnInfo = ''; 
    let returnButton = ''; 
    if (type === 'out') { 
        if (request.returnStatus === 'បានចូលមកវិញ') returnInfo = `<p class="text-sm font-semibold text-green-700 mt-2">✔️ បានចូលមកវិញ: ${request.returnedAt || ''}</p>`; 
        else if (request.status === 'approved') returnButton = `<button data-id="${request.requestId}" class="return-btn w-full mt-3 py-2 px-3 bg-green-600 text-white rounded-lg font-semibold text-sm shadow-sm hover:bg-green-700">បញ្ជាក់ចូលមកវិញ</button>`; 
    } 
    let invoiceButton = ''; 
    if (request.status === 'approved') invoiceButton = `<button data-id="${request.requestId}" data-type="${type}" class="invoice-btn mt-3 py-1.5 px-3 bg-indigo-100 text-indigo-700 rounded-md font-semibold text-xs shadow-sm hover:bg-indigo-200 w-full sm:w-auto">ពិនិត្យមើលវិក័យប័ត្រ</button>`; 
    
    // === MODIFIED: History Card Design (Modern) - ប្រើ glassmorphism ===
    return `<div class="glassmorphism rounded-xl p-4 mb-4">
        <div class="flex justify-between items-start mb-2">
            <span class="font-semibold text-gray-800 text-base">${request.duration || 'N/A'}</span>
            <span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColor}">${statusText}</span>
        </div>
        <p class="text-sm text-gray-600">${dateString}</p>
        <p class="text-sm text-gray-500 mt-1"><b>មូលហេតុ:</b> ${request.reason || 'មិនបានបញ្ជាក់'}</p>
        ${decisionInfo}
        ${returnInfo}
        <div class="mt-3 pt-3 border-t border-gray-100" style="border-color: rgba(255, 255, 255, 0.2) !important;">
            <div class="flex flex-wrap justify-between items-center gap-2">
                <p class="text-xs text-gray-400">ID: ${request.requestId}</p>
                <div class="flex items-center space-x-2">
                    ${showActions ? `
                        <button data-id="${request.requestId}" data-type="${type}" class="edit-btn p-1.5 text-blue-600 hover:bg-blue-100 rounded-full">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button data-id="${request.requestId}" data-type="${type}" class="delete-btn p-1.5 text-red-600 hover:bg-red-100 rounded-full">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    ` : ''}
                    ${invoiceButton}
                </div>
            </div>
            ${returnButton}
        </div>
    </div>`; 
}


/**
 * ធ្វើបច្ចុប្បន្នភាព State របស់ប៊ូតុងសុំច្បាប់
 */
function updateLeaveButtonState(openLeaveRequestBtn, isDisabled) {
    if (!openLeaveRequestBtn) return; 
    const leaveBtnText = openLeaveRequestBtn.querySelector('p.text-xs');
    if (isDisabled) {
        openLeaveRequestBtn.disabled = true;
        openLeaveRequestBtn.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-100');
        openLeaveRequestBtn.classList.remove('bg-blue-50', 'hover:bg-blue-100', 'glassmorphism'); // NEW: Remove glass if disabled
        if (leaveBtnText) leaveBtnText.textContent = 'មានសំណើកំពុងរង់ចាំ';
    } else {
        openLeaveRequestBtn.disabled = false;
        openLeaveRequestBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-100');
        openLeaveRequestBtn.classList.add('glassmorphism', 'hover:bg-blue-100'); // NEW: Add glass if enabled
        if (leaveBtnText) leaveBtnText.textContent = 'ឈប់សម្រាក';
    }
}

/**
 * ធ្វើបច្ចុប្បន្នភាព State របស់ប៊ូតុងចេញក្រៅ
 */
function updateOutButtonState(openOutRequestBtn, isDisabled) {
    if (!openOutRequestBtn) return;
    const outBtnText = openOutRequestBtn.querySelector('p.text-xs');
    if (isDisabled) {
        openOutRequestBtn.disabled = true;
        openOutRequestBtn.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-100');
        openOutRequestBtn.classList.remove('bg-green-50', 'hover:bg-green-100', 'glassmorphism'); // NEW: Remove glass if disabled
        if (outBtnText) outBtnText.textContent = 'មានសំណើកំពុងដំណើរការ';
    } else {
        openOutRequestBtn.disabled = false;
        openOutRequestBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-100');
        openOutRequestBtn.classList.add('glassmorphism', 'hover:bg-green-100'); // NEW: Add glass if enabled
        if (outBtnText) outBtnText.textContent = 'ចេញក្រៅផ្ទាល់ខ្លួន';
    }
}

/**
 * បើក History Listeners សម្រាប់ User
 */
export function setupHistoryListeners(db, currentEmployeeId, elements, alertHelpers) { 
    console.log("Setting up history listeners for employee ID:", currentEmployeeId); 
    if (!db || !currentEmployeeId) {
        console.error("Firestore DB not initialized or Employee ID not set.");
        return { leave: null, out: null };
    }
    
    const now = new Date(); 
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); 
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); 
    const startTimestamp = Timestamp.fromDate(startOfMonth); 
    const endTimestamp = Timestamp.fromDate(endOfMonth); 
    
    let leaveUnsubscribe = null;
    let outUnsubscribe = null;

    try { 
        const leaveQuery = query(collection(db, leaveRequestsCollectionPath), where("userId", "==", currentEmployeeId), where("requestedAt", ">=", startTimestamp), where("requestedAt", "<", endTimestamp)); 
        console.log("Querying Leave Requests for current month..."); 
        leaveUnsubscribe = onSnapshot(leaveQuery, (snapshot) => { 
            console.log(`Received LEAVE snapshot. Size: ${snapshot.size}`); 
            renderHistoryList(snapshot, elements.containerLeave, elements.placeholderLeave, 'leave', { leaveButton: elements.leaveButton, outButton: elements.outButton }, alertHelpers); 
        }, (error) => { 
            console.error("Error listening to LEAVE history:", error); 
            if (elements.placeholderLeave) { 
                elements.placeholderLeave.innerHTML = `<p class="text-red-500">Error: មិនអាចទាញយកប្រវត្តិបានទេ ${error.code.includes('permission-denied') ? '(Permission Denied)' : (error.code.includes('requires an index') ? '(ត្រូវបង្កើត Index សូមមើល Console)' : '')}</p>`; 
                elements.placeholderLeave.classList.remove('hidden'); 
            } 
        }); 
    } catch (e) { 
        console.error("Failed to create LEAVE history query:", e); 
        if (elements.placeholderLeave) elements.placeholderLeave.innerHTML = `<p class="text-red-500">Error: ${e.message}</p>`; 
        elements.placeholderLeave.classList.remove('hidden'); 
    } 
    
    try { 
        const outQuery = query(collection(db, outRequestsCollectionPath), where("userId", "==", currentEmployeeId), where("requestedAt", ">=", startTimestamp), where("requestedAt", "<", endTimestamp)); 
        console.log("Querying Out Requests for current month..."); 
        outUnsubscribe = onSnapshot(outQuery, (snapshot) => { 
            console.log(`Received OUT snapshot. Size: ${snapshot.size}`); 
            renderHistoryList(snapshot, elements.containerOut, elements.placeholderOut, 'out', { leaveButton: elements.leaveButton, outButton: elements.outButton }, alertHelpers); 
        }, (error) => { 
            console.error("Error listening to OUT history:", error); 
            if (elements.placeholderOut) { 
                elements.placeholderOut.innerHTML = `<p class="text-red-500">Error: មិនអាចទាញយកប្រវត្តិបានទេ ${error.code.includes('permission-denied') ? '(Permission Denied)' : (error.code.includes('requires an index') ? '(ត្រូវបង្កើត Index សូមមើល Console)' : '')}</p>`; 
                elements.placeholderOut.classList.remove('hidden'); 
            } 
        }); 
    } catch (e) { 
        console.error("Failed to create OUT history query:", e); 
        if (elements.placeholderOut) elements.placeholderOut.innerHTML = `<p class="text-red-500">Error: ${e.message}</p>`; 
        elements.placeholderOut.classList.remove('hidden'); 
    } 
    
    return { leave: leaveUnsubscribe, out: outUnsubscribe };
}


// --- EDIT / DELETE LOGIC ---

/**
 * បើក Edit Modal
 */
export async function openEditModal(db, requestId, type, elements, constants, setupSearchableDropdown) { 
    if (!db || !requestId || !type) return; 
    const collectionPath = (type === 'leave') ? leaveRequestsCollectionPath : outRequestsCollectionPath; 
    if (!collectionPath) return; 
    
    if (elements.loadingEl) elements.loadingEl.classList.remove('hidden'); 
    if (elements.errorEl) elements.errorEl.classList.add('hidden'); 
    if (elements.modal) elements.modal.classList.remove('hidden'); 
    
    try { 
        const requestRef = doc(db, collectionPath, requestId); 
        await updateDoc(requestRef, { status: 'editing' }); 
        console.log("Request status set to 'editing'"); 
        
        const docSnap = await getDoc(requestRef); 
        if (!docSnap.exists()) throw new Error("Document not found"); 
        const data = docSnap.data(); 

        if (elements.title) elements.title.textContent = (type === 'leave') ? "កែសម្រួលច្បាប់ឈប់" : "កែសម្រួលច្បាប់ចេញក្រៅ"; 
        if (elements.reqId) elements.reqId.value = requestId; 
        if (elements.reasonSearch) elements.reasonSearch.value = data.reason || ''; 
        if (elements.durationSearch) elements.durationSearch.value = data.duration; 

        const currentDurationItems = (type === 'leave' ? constants.leaveDurationItems : constants.outDurationItems);
        const currentReasonItems = (type === 'leave' ? constants.leaveReasonItems : constants.outReasonItems);
        
        setupSearchableDropdown(
            'edit-duration-search', 
            'edit-duration-dropdown', 
            currentDurationItems, 
            (duration) => { 
                // We need to define updateEditDateFields locally or pass it in
                updateEditDateFields(duration, type, elements, constants);
            }, 
            false
        );
        setupSearchableDropdown(
            'edit-reason-search', 
            'edit-reason-dropdown', 
            currentReasonItems, 
            () => {},
            true
        );

        if (type === 'leave') { 
            if (constants.singleDayLeaveDurations.includes(data.duration)) { 
                if (elements.singleDateContainer) elements.singleDateContainer.classList.remove('hidden'); 
                if (elements.dateRangeContainer) elements.dateRangeContainer.classList.add('hidden'); 
                if (elements.leaveDateSingle) elements.leaveDateSingle.value = data.startDate; 
            } else { 
                if (elements.singleDateContainer) elements.singleDateContainer.classList.add('hidden'); 
                if (elements.dateRangeContainer) elements.dateRangeContainer.classList.remove('hidden'); 
                if (elements.leaveDateStart) elements.leaveDateStart.value = Utils.parseDdMmmYyyyToInputFormat(data.startDate); 
                if (elements.leaveDateEnd) elements.leaveDateEnd.value = Utils.parseDdMmmYyyyToInputFormat(data.endDate); 
            } 
        } else { 
            if (elements.singleDateContainer) elements.singleDateContainer.classList.remove('hidden'); 
            if (elements.dateRangeContainer) elements.dateRangeContainer.classList.add('hidden'); 
            if (elements.leaveDateSingle) elements.leaveDateSingle.value = data.startDate; 
        } 
        
        if (elements.loadingEl) elements.loadingEl.classList.add('hidden'); 
    } catch (e) { 
        console.error("Error opening edit modal:", e); 
        if (elements.loadingEl) elements.loadingEl.classList.add('hidden'); 
        if (elements.errorEl) { 
            elements.errorEl.textContent = `Error: ${e.message}`; 
            elements.errorEl.classList.remove('hidden'); 
        } 
    } 
}

/**
 * ធ្វើបច្ចុប្បន្នភាព Date Fields ពេលកំពុង Edit
 */
function updateEditDateFields(duration, type, elements, constants) {
    if (type === 'out') {
        elements.singleDateContainer.classList.remove('hidden');
        elements.dateRangeContainer.classList.add('hidden');
        return;
    }
    if (!duration) {
        elements.singleDateContainer.classList.add('hidden');
        elements.dateRangeContainer.classList.add('hidden');
        return;
    }
    if (constants.singleDayLeaveDurations.includes(duration)) {
        elements.singleDateContainer.classList.remove('hidden');
        elements.dateRangeContainer.classList.add('hidden');
        if (elements.leaveDateStart.value) {
            elements.leaveDateSingle.value = Utils.formatDateToDdMmmYyyy(Utils.formatInputDateToDb(elements.leaveDateStart.value));
        }
    } else {
        elements.singleDateContainer.classList.add('hidden');
        elements.dateRangeContainer.classList.remove('hidden');
        let startDateInputVal;
        if (elements.leaveDateStart.value) {
            startDateInputVal = elements.leaveDateStart.value;
        } else {
            startDateInputVal = Utils.parseDdMmmYyyyToInputFormat(elements.leaveDateSingle.value);
            elements.leaveDateStart.value = startDateInputVal; 
        }
        const days = constants.durationToDaysMap[duration] ?? 1;
        const endDateValue = Utils.addDays(startDateInputVal, days);
        elements.leaveDateEnd.value = endDateValue; 
    }
}

/**
 * បោះបង់ Edit
 */
export async function cancelEdit(db, requestId, modalTitle) {
    const type = (modalTitle.includes("ឈប់")) ? 'leave' : 'out'; 
    const collectionPath = (type === 'leave') ? leaveRequestsCollectionPath : outRequestsCollectionPath; 
    if (requestId && collectionPath) { 
        try { 
            const requestRef = doc(db, collectionPath, requestId); 
            await updateDoc(requestRef, { status: 'pending' }); 
            console.log("Edit cancelled, status reverted to 'pending'"); 
        } catch (e) { 
            console.error("Error reverting status on edit cancel:", e); 
        } 
    }
}

/**
 * បញ្ជូន Edit
 */
export async function submitEdit(db, requestId, type, data, dates, elements, helpers) {
    const { duration: newDuration, reason: newReason } = data;
    const { singleDate, startDate, endDate } = dates;
    const { errorEl, loadingEl, modal } = elements;
    const { singleDayLeaveDurations, showCustomAlert } = helpers;

    if (!newDuration) {
        if(errorEl) { errorEl.textContent = "សូមជ្រើសរើស \"រយៈពេល\" ឲ្យបានត្រឹមត្រូវ (ពីក្នុងបញ្ជី)។"; errorEl.classList.remove('hidden'); } 
        return;
    }
    if (!newReason || newReason.trim() === '') { 
        if(errorEl) { errorEl.textContent = "មូលហេតុមិនអាចទទេបានទេ។"; errorEl.classList.remove('hidden'); } 
        return; 
    } 
    
    if (loadingEl) loadingEl.classList.remove('hidden'); 
    if (errorEl) errorEl.classList.add('hidden'); 

    try { 
        const collectionPath = (type === 'leave') ? leaveRequestsCollectionPath : outRequestsCollectionPath; 
        const isSingleDay = (type === 'out') || singleDayLeaveDurations.includes(newDuration);
        let finalStartDate, finalEndDate, dateStringForTelegram;

        if (isSingleDay) {
            let singleDateVal = singleDate; 
            if (!singleDateVal || !Utils.parseDdMmmYyyyToInputFormat(singleDateVal)) { 
                singleDateVal = Utils.formatDateToDdMmmYyyy(Utils.formatInputDateToDb(startDate)); 
            }
            finalStartDate = singleDateVal;
            finalEndDate = singleDateVal;
            dateStringForTelegram = finalStartDate; 
        } else {
            finalStartDate = Utils.formatDateToDdMmmYyyy(Utils.formatInputDateToDb(startDate)); 
            finalEndDate = Utils.formatDateToDdMmmYyyy(Utils.formatInputDateToDb(endDate)); 
            dateStringForTelegram = `ពី ${Utils.formatInputDateToDb(startDate)} ដល់ ${Utils.formatInputDateToDb(endDate)}`; 
        }

        const requestRef = doc(db, collectionPath, requestId); 
        
        await updateDoc(requestRef, { 
            duration: newDuration,
            reason: newReason.trim(), 
            startDate: finalStartDate,
            endDate: finalEndDate,
            status: 'pending', 
            requestedAt: serverTimestamp(),
            decisionBy: null,
            decisionAt: null,
            returnStatus: (type === 'out') ? 'N/A' : null,
            returnedAt: null
        }); 
        
        console.log("Edit submitted, status set to 'pending' with new duration/dates"); 
        
        let message = `<b>🔔 សំណើត្រូវបានកែសម្រួល 🔔</b>\n\n`; 
        message += `<b>ID:</b> \`${requestId}\`\n`; 
        message += `<b>រយៈពេលថ្មី:</b> ${newDuration}\n`;
        message += `<b>មូលហេតុថ្មី:</b> ${newReason.trim()}\n`;
        message += `<b>កាលបរិច្ឆេទ:</b> ${dateStringForTelegram}\n\n`;
        message += `(សំណើនេះ ឥឡូវនេះ ស្ថិតក្នុងស្ថានភាព 'pending' ឡើងវិញ)`; 
        await sendTelegramNotification(message); 
        
        if (loadingEl) loadingEl.classList.add('hidden'); 
        if (modal) modal.classList.add('hidden'); 
    } catch (e) { 
        console.error("Error submitting edit:", e); 
        if (loadingEl) loadingEl.classList.add('hidden'); 
        if (errorEl) { 
            errorEl.textContent = `Error: ${e.message}`; 
            errorEl.classList.remove('hidden'); 
        } 
    }
}

/**
 * លុបសំណើ
 */
export async function deleteRequest(db, requestId, type, elements, showCustomAlert) {
    const collectionPath = (type === 'leave') ? leaveRequestsCollectionPath : outRequestsCollectionPath; 
    if (!db || !requestId || !collectionPath) { 
        console.error("Cannot delete: Missing info"); 
        return showCustomAlert("Error", "មិនអាចលុបបានទេ។"); 
    } 
    console.log("Attempting to delete doc:", requestId, "from:", collectionPath); 
    elements.confirmBtn.disabled = true; 
    elements.confirmBtn.textContent = 'កំពុងលុប...'; 
    try { 
        const requestRef = doc(db, collectionPath, requestId); 
        await deleteDoc(requestRef); 
        console.log("Document successfully deleted!"); 
        if (elements.modal) elements.modal.classList.add('hidden'); 
    } catch (e) { 
        console.error("Error deleting document:", e); 
        showCustomAlert("Error", `មិនអាចលុបបានទេ។ ${e.message}`); 
    } finally { 
        elements.confirmBtn.disabled = false; 
        elements.confirmBtn.textContent = 'យល់ព្រមលុប'; 
    }
}


// --- RETURN SCAN LOGIC ---

export function setCurrentReturnRequestId(id) {
    currentReturnRequestId = id;
}

export async function updateReturnStatusInFirestore(db, elements) { 
    if (!currentReturnRequestId) { 
        console.error("Cannot update return status: No request ID"); 
        return; 
    } 
    try { 
        const docRef = doc(db, outRequestsCollectionPath, currentReturnRequestId); 
        const now = new Date(); 
        const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); 
        const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); 
        const returnedAtString = `${time} ${date}`; 
        await updateDoc(docRef, { returnStatus: "បានចូលមកវិញ", returnedAt: returnedAtString }); 
        console.log("Return status updated successfully."); 
        elements.showCustomAlert("ជោគជ័យ!", "បញ្ជាក់ការចូលមកវិញ បានជោគជ័យ!", "success"); 
    } catch (e) { 
        console.error("Error updating Firestore return status:", e); 
        elements.showCustomAlert("Error", `មានបញ្ហាពេលរក្សាទុក: ${e.message}`); 
    } finally { 
        if (elements.modal) elements.modal.classList.add('hidden'); 
        currentReturnRequestId = null; 
    } 
}

// --- INVOICE LOGIC ---

export function hideInvoiceModal(invoiceModal, invoiceShareStatus, shareInvoiceBtn) { 
    if (invoiceModal) invoiceModal.classList.add('hidden'); 
    if (invoiceShareStatus) invoiceShareStatus.textContent = ''; 
    if (shareInvoiceBtn) shareInvoiceBtn.disabled = false; 
}

export async function openInvoiceModal(db, requestId, type, elements, showCustomAlert) { 
    console.log(`--- Attempting to open invoice for ${type} request ID: ${requestId} ---`); 
    if (!db || !requestId || !type) { 
        return showCustomAlert("Error", "មិនអាចបើកវិក័យប័ត្របានទេ (Missing ID or Type)"); 
    } 
    const collectionPath = (type === 'leave') ? leaveRequestsCollectionPath : outRequestsCollectionPath; 
    if (!collectionPath) { 
        return showCustomAlert("Error", "មិនអាចបើកវិក័យប័ត្របានទេ (Invalid Collection Path)"); 
    } 
    if (!elements.modal) { 
        console.error("Invoice modal element not found!"); 
        return; 
    } 
    elements.modal.classList.remove('hidden'); 
    
    // Reset fields
    elements.userName.textContent='កំពុងទាញយក...'; 
    elements.userId.textContent='...'; 
    elements.userDept.textContent='...'; 
    elements.requestType.textContent='...'; 
    elements.duration.textContent='...'; 
    elements.dates.textContent='...'; 
    elements.reason.textContent='...'; 
    elements.approver.textContent='...'; 
    elements.decisionTime.textContent='...'; 
    elements.reqId.textContent='...'; 
    elements.returnInfo.classList.add('hidden'); 
    elements.shareBtn.disabled = true; 
    
    try { 
        const docRef = doc(db, collectionPath, requestId); 
        console.log("Fetching Firestore doc:", docRef.path); 
        const docSnap = await getDoc(docRef); 
        if (!docSnap.exists()) { 
            throw new Error("រកមិនឃើញសំណើរនេះទេ។"); 
        } 
        console.log("Firestore doc found."); 
        const data = docSnap.data(); 
        const requestTypeText = (type === 'leave') ? 'ច្បាប់ឈប់សម្រាក' : 'ច្បាប់ចេញក្រៅ'; 
        const decisionTimeText = Utils.formatFirestoreTimestamp(data.decisionAt || data.requestedAt); 
        const dateRangeText = (data.startDate === data.endDate) ? data.startDate : `${data.startDate} ដល់ ${data.endDate}`; 
        
        elements.title.textContent = `វិក័យប័ត្រ - ${requestTypeText}`; 
        elements.userName.textContent = data.name || 'N/A'; 
        elements.userId.textContent = data.userId || 'N/A'; 
        elements.userDept.textContent = data.department || 'N/A'; 
        elements.requestType.textContent = requestTypeText; 
        elements.duration.textContent = data.duration || 'N/A'; 
        elements.dates.textContent = dateRangeText; 
        elements.reason.textContent = data.reason || 'N/Examples/N/A'; 
        elements.approver.textContent = data.decisionBy || "លោកគ្រូ ពៅ ដារ៉ូ"; 
        elements.decisionTime.textContent = decisionTimeText; 
        elements.reqId.textContent = data.requestId || requestId; 
        
        if (type === 'out' && data.returnStatus === 'បានចូលមកវិញ') { 
            elements.returnStatus.textContent = data.returnStatus; 
            elements.returnTime.textContent = data.returnedAt || 'N/A'; 
            elements.returnInfo.classList.remove('hidden'); 
        } else { 
            elements.returnInfo.classList.add('hidden'); 
        } 
        
        elements.shareBtn.dataset.requestId = data.requestId || requestId; 
        elements.shareBtn.dataset.userName = data.name || 'User'; 
        elements.shareBtn.dataset.requestType = requestTypeText; 
        elements.shareBtn.disabled = false; 
        
        console.log("Invoice modal populated."); 
    } catch (error) { 
        console.error("Error opening/populating invoice modal:", error); 
        hideInvoiceModal(elements.modal, elements.shareStatus, elements.shareBtn); 
        showCustomAlert("Error", `មិនអាចផ្ទុកទិន្នន័យវិក័យប័ត្របានទេ: ${error.message}`); 
    } 
}

export async function shareInvoiceAsImage(invoiceContent, invoiceContentWrapper, shareInvoiceBtn, invoiceShareStatus, showCustomAlert) { 
    if (!invoiceContent || typeof html2canvas === 'undefined' || !shareInvoiceBtn) { 
        return showCustomAlert("Error", "មុខងារ Share មិនទាន់រួចរាល់ ឬ Library បាត់។"); 
    } 
    if(invoiceShareStatus) invoiceShareStatus.textContent = 'កំពុងបង្កើតរូបភាព...'; 
    shareInvoiceBtn.disabled = true; 
    
    try { 
        if(invoiceContentWrapper) invoiceContentWrapper.scrollTop = 0; 
        await new Promise(resolve => setTimeout(resolve, 100)); 
        const canvas = await html2canvas(invoiceContent, { scale: 2, useCORS: true, logging: false }); 
        
        canvas.toBlob(async (blob) => { 
            if (!blob) { 
                throw new Error("មិនអាចបង្កើតរូបភាព Blob បានទេ។"); 
            } 
            if(invoiceShareStatus) invoiceShareStatus.textContent = 'កំពុងព្យាយាម Share...'; 
            
            if (navigator.share && navigator.canShare) { 
                const fileName = `Invoice_${shareInvoiceBtn.dataset.requestId || 'details'}.png`; 
                const file = new File([blob], fileName, { type: blob.type }); 
                const shareData = { 
                    files: [file], 
                    title: `វិក័យប័ត្រសុំច្បាប់ (${shareInvoiceBtn.dataset.requestType || ''})`, 
                    text: `វិក័យប័ត្រសុំច្បាប់សម្រាប់ ${shareInvoiceBtn.dataset.userName || ''} (ID: ${shareInvoiceBtn.dataset.requestId || ''})`, 
                }; 
                
                if (navigator.canShare(shareData)) { 
                    try { 
                        await navigator.share(shareData); 
                        console.log('Invoice shared successfully via Web Share API'); 
                        if(invoiceShareStatus) invoiceShareStatus.textContent = 'Share ជោគជ័យ!'; 
                    } catch (err) { 
                        console.error('Web Share API error:', err); 
                        if(invoiceShareStatus) invoiceShareStatus.textContent = 'Share ត្រូវបានបោះបង់។'; 
                        if (err.name !== 'AbortError') showCustomAlert("Share Error", "មិនអាច Share បានតាម Web Share API។ សូមព្យាយាមម្តងទៀត។"); 
                    } 
                } else { 
                    console.warn('Web Share API cannot share this data.'); 
                    if(invoiceShareStatus) invoiceShareStatus.textContent = 'មិនអាច Share file បាន។'; 
                    showCustomAlert("Share Error", "Browser នេះមិនគាំទ្រការ Share file ទេ។ សូមធ្វើការ Screenshot ដោយដៃ។"); 
                } 
            } else { 
                console.warn('Web Share API not supported.'); 
                if(invoiceShareStatus) invoiceShareStatus.textContent = 'Web Share មិនដំណើរការ។'; 
                showCustomAlert("សូម Screenshot", "Browser នេះមិនគាំទ្រ Web Share API ទេ។ សូមធ្វើការ Screenshot វិក័យប័ត្រនេះដោយដៃ រួច Share ទៅ Telegram។"); 
            } 
            shareInvoiceBtn.disabled = false; 
        }, 'image/png'); 
    } catch (error) { 
        console.error("Error generating or sharing invoice image:", error); 
        if(invoiceShareStatus) invoiceShareStatus.textContent = 'Error!'; 
        showCustomAlert("Error", `មានបញ្ហាក្នុងការបង្កើត ឬ Share រូបភាព: ${error.message}`); 
        shareInvoiceBtn.disabled = false; 
    } 
}

// --- APPROVER LOGIC ---

/**
 * បើក Approver Listeners
 */
export function setupApproverListeners(db, pendingCountEl, containerPending, containerHistory) {
    console.log("Setting up Approver Dashboard listeners...");
    if (!db) {
        console.error("Firestore DB not initialized for Approver.");
        return { pending: null, history: null };
    }

    let pendingUnsubscribe = null;
    let historyUnsubscribe = null;

    try {
        // Query 1: Pending Requests
        const pendingQuery = query(collection(db, leaveRequestsCollectionPath), where("status", "in", ["pending", "editing"]));
        const outPendingQuery = query(collection(db, outRequestsCollectionPath), where("status", "in", ["pending", "editing"]));
        
        pendingUnsubscribe = onSnapshot(pendingQuery, (leaveSnapshot) => {
             onSnapshot(outPendingQuery, (outSnapshot) => {
                const combinedSnapshot = [...leaveSnapshot.docs.map(d => ({ ...d.data(), type: 'leave' })), ...outSnapshot.docs.map(d => ({ ...d.data(), type: 'out' }))];
                renderApproverList(combinedSnapshot, containerPending, pendingCountEl, 'pending');
            }, (error) => console.error("Error listening to OUT Pending:", error));
        }, (error) => console.error("Error listening to LEAVE Pending:", error));

        // Query 2: History (This month)
        const now = new Date();
        const startOfMonth = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1));
        const endOfMonth = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
        
        const historyQuery = query(collection(db, leaveRequestsCollectionPath), where("status", "in", ["approved", "rejected"]), where("decisionAt", ">=", startOfMonth), where("decisionAt", "<", endOfMonth));
        const outHistoryQuery = query(collection(db, outRequestsCollectionPath), where("status", "in", ["approved", "rejected"]), where("decisionAt", ">=", startOfMonth), where("decisionAt", "<", endOfMonth));

        historyUnsubscribe = onSnapshot(historyQuery, (leaveSnapshot) => {
             onSnapshot(outHistoryQuery, (outSnapshot) => {
                const combinedSnapshot = [...leaveSnapshot.docs.map(d => ({ ...d.data(), type: 'leave' })), ...outSnapshot.docs.map(d => ({ ...d.data(), type: 'out' }))];
                renderApproverList(combinedSnapshot, containerHistory, pendingCountEl, 'history');
            }, (error) => console.error("Error listening to OUT History:", error));
        }, (error) => console.error("Error listening to LEAVE History:", error));

    } catch (e) {
        console.error("Failed to create Approver queries:", e);
    }
    
    return { pending: pendingUnsubscribe, history: historyUnsubscribe };
}

/**
 * បង្ហាញ Approver List
 */
function renderApproverList(requests, container, pendingCountEl, listType) {
    if (!container) return;
    
    requests.sort((a, b) => {
        const timeA = (listType === 'pending' ? a.requestedAt?.toMillis() : a.decisionAt?.toMillis()) ?? 0;
        const timeB = (listType === 'pending' ? b.requestedAt?.toMillis() : b.decisionAt?.toMillis()) ?? 0;
        return timeB - timeA; 
    });

    if (listType === 'pending' && pendingCountEl) {
        pendingCountEl.textContent = requests.length;
    }

    const placeholderId = (listType === 'pending') ? 'approver-placeholder-pending' : 'approver-placeholder-history';
    const placeholder = document.getElementById(placeholderId);

    if (requests.length === 0) {
        if (placeholder) placeholder.classList.remove('hidden');
        container.innerHTML = '';
        return;
    }

    if (placeholder) placeholder.classList.add('hidden');
    container.innerHTML = requests.map(request => renderApproverCard(request, listType)).join('');
}

/**
 * បង្កើត HTML សម្រាប់ Approver Card
 */
function renderApproverCard(request, listType) {
    if (!request || !request.requestId) return '';
    let statusColor, statusText, actionButtons = '', returnInfo = '';

    switch(request.status) {
        case 'approved':
            statusColor = 'bg-green-100 text-green-800'; statusText = 'បានយល់ព្រម';
            if (request.type === 'out' && request.returnStatus === 'បានចូលមកវិញ') {
                 returnInfo = `<p class="text-xs text-green-600 mt-1 font-semibold">✔️ ចូលវិញ: ${request.returnedAt || 'N/A'}</p>`;
            }
            break;
        case 'rejected':
            statusColor = 'bg-red-100 text-red-800'; statusText = 'បានបដិសធ';
            break;
        case 'editing':
            statusColor = 'bg-blue-100 text-blue-800'; statusText = 'កំពុងកែសម្រួល';
            break;
        default:
            statusColor = 'bg-yellow-100 text-yellow-800'; statusText = 'កំពុងរង់ចាំ';
logo   }

    if (listType === 'pending' && (request.status === 'pending' || request.status === 'editing')) {
        actionButtons = `
            <div class="flex space-x-2 mt-3">
                <button data-id="${request.requestId}" data-type="${request.type}" data-action="approve" class="action-btn flex-1 py-2 px-3 bg-green-600 text-white rounded-lg font-semibold text-sm shadow-sm hover:bg-green-700">អនុម័ត</button>
                <button data-id="${request.requestId}" data-type="${request.type}" data-action="reject" class="action-btn flex-1 py-2 px-3 bg-red-600 text-white rounded-lg font-semibold text-sm shadow-sm hover:bg-red-700">បដិសធ</button>
            </div>
        `;
    }

    const requestTypeText = (request.type === 'leave') ? 'ឈប់សម្រាក' : 'ចេញក្រៅ';
    const decisionTime = request.decisionAt ? Utils.formatFirestoreTimestamp(request.decisionAt) : '';
    const dateString = (request.startDate === request.endDate) ? request.startDate : `${request.startDate} ដល់ ${request.endDate}`;

    return `
        <div class="glassmorphism rounded-lg p-4 mb-4">
            <div class="flex justify-between items-start">
                <div class="text-sm">
                    <p class="font-bold text-gray-800">${request.name} (${request.userId})</p>
                    <p class="text-xs text-gray-500">${request.department || 'N/A'} - ${requestTypeText}</p>
                </div>
                <span class="text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}">${statusText}</span>
            </div>
            <hr class="my-2 border-gray-100" style="border-color: rgba(255, 255, 255, 0.2) !important;">
            <p class="text-sm font-semibold text-gray-700">${request.duration || 'N/A'}</p>
            <p class="text-sm text-gray-600 mt-0.5">🗓️ ${dateString}</p>
            <p class="text-xs text-gray-500 mt-1"><b>មូលហេតុ:</b> ${request.reason || 'មិនបានបញ្ជាក់'}</p>
            ${listType === 'history' ? `<p class="text-xs text-gray-400 mt-1">សម្រេចនៅ៖ ${decisionTime}</p>` : ''}
            ${returnInfo}
            ${actionButtons}
        </div>
    `;
}

/**
 * គ្រប់គ្រងការចុច Approve/Reject
 */
export async function handleApproverAction(event, db, currentUser, isApprover, showCustomAlert, sendTelegramNotification) {
    const btn = event.target.closest('.action-btn');
    if (!btn) return;

    event.preventDefault();
    const requestId = btn.dataset.id;
    const type = btn.dataset.type;
    const action = btn.dataset.action; 
    const collectionPath = (type === 'leave') ? leaveRequestsCollectionPath : outRequestsCollectionPath;

    if (!currentUser || !isApprover) {
        return showCustomAlert("Permission Denied", "អ្នកមិនមានសិទ្ធិអនុវត្តសកម្មភាពនេះទេ។");
    }
    if (!db || !requestId || !collectionPath) {
        return showCustomAlert("Error", "មិនអាចដំណើរការសំណើបានទេ (Missing Data)។");
    }
    
    const confirmation = confirm(`តើអ្នកពិតជាចង់ ${action === 'approve' ? 'អនុម័ត' : 'បដិសេធ'} សំណើ ID: ${requestId} មែនទេ?`);
    if (!confirmation) return;

    btn.disabled = true;
    btn.textContent = 'កំពុងដំណើរការ...';
    
    try {
        const docRef = doc(db, collectionPath, requestId);
        const newStatus = (action === 'approve') ? 'approved' : 'rejected';

        await updateDoc(docRef, {
            status: newStatus,
            decisionBy: currentUser.name || 'Admin',
            decisionAt: serverTimestamp(),
            returnStatus: (type === 'out' && newStatus === 'approved') ? 'រង់ចាំចូលវិញ' : (type === 'out' ? 'N/A' : null)
        });

        console.log(`Request ${requestId} set to status: ${newStatus}`);

        const cardElement = btn.closest('.glassmorphism'); // MODIFIED: Find the new glassmorphism parent
        const userNameText = cardElement ? cardElement.querySelector('.font-bold').textContent : 'Unknown User';
        
        let telegramMsg = `<b>✅ សំណើត្រូវបានសម្រេច (${newStatus.toUpperCase()}) ✅</b>\n\n`;
        telegramMsg += `<b>ID:</b> \`${requestId}\`\n`;
        telegramMsg += `<b>ឈ្មោះ:</b> ${userNameText}\n`;
        telegramMsg += `<b>សកម្មភាព:</b> ${newStatus === 'approved' ? 'បានអនុម័ត' : 'បានបដិសេធ'} ដោយ ${currentUser.name || 'Admin'}\n`;
        await sendTelegramNotification(telegramMsg);

        showCustomAlert("ជោគជ័យ!", `${newStatus === 'approved' ? 'ការអនុម័ត' : 'ការបដិសេធ'} បានជោគជ័យ។`, 'success');

    } catch (e) {
        console.error(`Error processing action ${action} for ${requestId}:`, e);
        showCustomAlert("Error", `មានបញ្ហាពេលរក្សាទុក៖ ${e.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = action === 'approve' ? 'អនុម័ត' : 'បដិសធ';
    }
}

/**
 * គ្រប់គ្រងការចុចលើ History Card (Edit, Delete, Return, Invoice)
 */
export function handleHistoryTap(event, db, outRequestsCollectionPath, openEditModal, openDeleteModal, startReturnConfirmation, openInvoiceModal) {
    const invoiceBtn = event.target.closest('.invoice-btn');
    const returnBtn = event.target.closest('.return-btn');
    const editBtn = event.target.closest('.edit-btn');
    const deleteBtn = event.target.closest('.delete-btn');

    if (invoiceBtn) {
        event.preventDefault();
        openInvoiceModal(invoiceBtn.dataset.id, invoiceBtn.dataset.type);
    } else if (returnBtn) {
        event.preventDefault();
        startReturnConfirmation(returnBtn.dataset.id);
    } else if (editBtn) {
        event.preventDefault();
        openEditModal(editBtn.dataset.id, editBtn.dataset.type);
    } else if (deleteBtn) {
        event.preventDefault();
        openDeleteModal(deleteBtn.dataset.id, deleteBtn.dataset.type);
    }
}
