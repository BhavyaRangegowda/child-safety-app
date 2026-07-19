console.log("Capacitor =", window.Capacitor);
    console.log("Plugins =", window.Capacitor?.Plugins);
    console.log("Filesystem plugin =", window.Capacitor?.Plugins?.Filesystem);
    console.log("FileViewer plugin =", window.Capacitor?.Plugins?.FileViewer);
    let compressedPhotoBase64 = "";
    let isSubmitting = false;
    let isPreparingPhoto = false;
    let progressTimerOne = null;
    let progressTimerTwo = null;
    let activeRequestController = null;
    let lastSubmittedPayload = null;
    let lastSavedPdfPath = "";
    let lastSavedPdfName = "";
    let activeSubmissionRequestId = null;

    function setSubmissionControlsDisabled(isDisabled) {
        const form = document.getElementById('broadcastForm');
        if (!form) {
            return;
        }

        form.querySelectorAll('input, select, textarea, button').forEach((control) => {
            if (control.id === 'statusMessage') {
                return;
            }
            control.disabled = isDisabled;
        });
    }

    let successAudioContext = null;
    const addressInput = document.getElementById('addressInput');
    const autocompleteDropdown = document.getElementById('autocompleteDropdown');
    let debounceTimer;

 function acceptTerms() {
    localStorage.setItem("termsAccepted", "true");
    document.getElementById('legalOverlay').style.display = 'none';
    document.getElementById('broadcastForm').style.display = 'block';
}
    addressInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        const query = this.value.trim();
        autocompleteDropdown.innerHTML = '';
        if (query.length < 3) { autocompleteDropdown.style.display = 'none'; return; }

        debounceTimer = setTimeout(async () => {
            try {
                throw new Error('Autocomplete disabled - manual address entry is supported.');
                const data = await response.json();
                if (data && data.length > 0) {
                    autocompleteDropdown.innerHTML = '';
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.innerText = item.display_name;
                        div.addEventListener('click', function() {
                            addressInput.value = item.display_name.trim();
                            autocompleteDropdown.style.display = 'none';
                        });
                        autocompleteDropdown.appendChild(div);
                    });
                    autocompleteDropdown.style.display = 'block';
                } else {
                    autocompleteDropdown.style.display = 'none';
                }
            } catch (err) {
                console.warn('Address autocomplete unavailable:', err?.message || err);
                autocompleteDropdown.style.display = 'none';
            }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (e.target !== addressInput) autocompleteDropdown.style.display = 'none';
    });

    const camBtn = document.getElementById('camBtn');
    const galleryBtn = document.getElementById('galleryBtn');
  
    const hiddenFilePicker = document.getElementById('hiddenFilePicker');
    const photoPreviewBox = document.getElementById('photoPreviewBox');
    const photoContextDropdown = document.getElementById('photoContext');
    const photoClothingWarning = document.getElementById('photoClothingWarning');
    const contactPhoneInput = document.getElementById('contactPhone');
    const altPhoneInput = document.getElementById('altPhone');
    const parentEmailInput = document.getElementById('parentEmail');
    const contactPhoneError = document.getElementById('contactPhoneError');
    const altPhoneError = document.getElementById('altPhoneError');
    const parentEmailError = document.getElementById('parentEmailError');
    const dateLastSeenInput = document.getElementById('dateLastSeen');
    const timeLastSeenInput = document.getElementById('timeLastSeen');
    const dateLastSeenError = document.getElementById('dateLastSeenError');
    const timeLastSeenError = document.getElementById('timeLastSeenError');

    function getLocalDateValue(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function setDateInputMax() {
        if (dateLastSeenInput) {
            dateLastSeenInput.max = getLocalDateValue();
        }
    }

    setDateInputMax();

    function setStatusMessage(message, isError = false) {
        const statusBox = document.getElementById('statusMessage');
        if (!statusBox) {
            return;
        }

        statusBox.style.color = isError ? '#d9534f' : '#666';
        statusBox.innerText = message;
    }

    function dataUrlToBlob(dataUrl) {
        return new Promise((resolve, reject) => {
            try {
                const parts = dataUrl.split(',');
                if (parts.length < 2) {
                    reject(new Error('Photo data is missing.'));
                    return;
                }

                const metadata = parts[0];
                const base64Data = parts[1];
                const mimeMatch = metadata.match(/data:(.*?);/);
                const mimeType = mimeMatch && mimeMatch[1] ? mimeMatch[1] : 'image/jpeg';
                const binary = window.atob(base64Data);
                const bytes = new Uint8Array(binary.length);

                for (let index = 0; index < binary.length; index += 1) {
                    bytes[index] = binary.charCodeAt(index);
                }

                resolve(new Blob([bytes], { type: mimeType }));
            } catch (error) {
                reject(error);
            }
        });
    }

    async function canvasToDataUrl(canvas, mimeType, quality) {
        return new Promise((resolve, reject) => {
            if (typeof canvas.toBlob === 'function') {
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Photo processing failed.'));
                        return;
                    }

                    const reader = new FileReader();
                    reader.onloadend = () => {
                        if (typeof reader.result === 'string') {
                            resolve(reader.result);
                        } else {
                            reject(new Error('Photo data could not be prepared.'));
                        }
                    };
                    reader.onerror = () => reject(new Error('Photo data could not be prepared.'));
                    reader.readAsDataURL(blob);
                }, mimeType, quality);
                return;
            }

            resolve(canvas.toDataURL(mimeType, quality));
        });
    }

    async function optimizePhotoDataUrl(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:image')) {
            throw new Error('Photo data is missing.');
        }

        const sourceBlob = await dataUrlToBlob(dataUrl);
        const sourceBitmap = typeof window.createImageBitmap === 'function'
            ? await window.createImageBitmap(sourceBlob)
            : await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Photo could not be loaded.'));
                image.src = dataUrl;
            });

        const maxLongEdge = 2000;
        const originalMaxDimension = Math.max(sourceBitmap.width || 0, sourceBitmap.height || 0);
        const scale = originalMaxDimension > maxLongEdge ? maxLongEdge / originalMaxDimension : 1;
        let targetWidth = Math.max(1, Math.round((sourceBitmap.width || 1) * scale));
        let targetHeight = Math.max(1, Math.round((sourceBitmap.height || 1) * scale));
        const qualitySteps = [0.85, 0.75, 0.65];
        const sizeSteps = [1, 0.9, 0.8];

        for (let attempt = 0; attempt < qualitySteps.length; attempt += 1) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(targetWidth));
            canvas.height = Math.max(1, Math.round(targetHeight));
            const context = canvas.getContext('2d');

            if (!context) {
                throw new Error('Photo processing canvas is unavailable.');
            }

            context.drawImage(sourceBitmap, 0, 0, canvas.width, canvas.height);
            const optimizedDataUrl = await canvasToDataUrl(canvas, 'image/jpeg', qualitySteps[attempt]);
            const outputBytes = window.atob(optimizedDataUrl.split(',')[1] || '');

            if (outputBytes.length <= 1.5 * 1024 * 1024) {
                return optimizedDataUrl;
            }

            const adjustment = sizeSteps[Math.min(attempt, sizeSteps.length - 1)];
            targetWidth = Math.max(1, Math.round(targetWidth * adjustment));
            targetHeight = Math.max(1, Math.round(targetHeight * adjustment));
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(targetWidth));
        canvas.height = Math.max(1, Math.round(targetHeight));
        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('Photo processing canvas is unavailable.');
        }

        context.drawImage(sourceBitmap, 0, 0, canvas.width, canvas.height);
        return canvasToDataUrl(canvas, 'image/jpeg', 0.65);
    }

    async function prepareSelectedPhoto(dataUrl, contextValue, showClothingWarning) {
        if (!dataUrl) {
            return;
        }

        setStatusMessage('Preparing photo...');
        photoPreviewBox.innerText = '';
        photoPreviewBox.style.backgroundImage = `url(${dataUrl})`;
        photoPreviewBox.style.borderColor = '#5cb85c';

        photoContextDropdown.disabled = false;
        photoContextDropdown.value = contextValue;
        photoContextDropdown.disabled = true;

        if (photoClothingWarning) {
            photoClothingWarning.classList.toggle('visible', showClothingWarning);
        }

        isPreparingPhoto = true;

        try {
            const optimizedDataUrl = await optimizePhotoDataUrl(dataUrl);
            compressedPhotoBase64 = optimizedDataUrl;
            setStatusMessage('Ready to submit alert pass details.');
        } catch (error) {
            console.warn('Photo optimization unavailable:', error?.message || error);
            compressedPhotoBase64 = dataUrl;
            setStatusMessage('The selected photo could not be processed. Please take a new photo or choose another photo.', true);
        } finally {
            isPreparingPhoto = false;
        }
    }

    function clearValidationMessage(input, messageElement) {
        if (input) {
            input.classList.remove('input-invalid');
        }
        if (messageElement) {
            messageElement.textContent = '';
            messageElement.classList.remove('visible');
        }
    }

    function clearAllValidationMessages() {
        clearValidationMessage(contactPhoneInput, contactPhoneError);
        clearValidationMessage(altPhoneInput, altPhoneError);
        clearValidationMessage(parentEmailInput, parentEmailError);
        clearValidationMessage(dateLastSeenInput, dateLastSeenError);
        clearValidationMessage(timeLastSeenInput, timeLastSeenError);
    }

    function validateDateTimeFields() {
        const dateValue = dateLastSeenInput ? dateLastSeenInput.value.trim() : '';
        const timeValue = timeLastSeenInput ? timeLastSeenInput.value.trim() : '';

        if (!dateValue) {
            return true;
        }

        const todayValue = getLocalDateValue();
        if (dateValue > todayValue) {
            if (dateLastSeenInput) {
                dateLastSeenInput.classList.add('input-invalid');
            }
            if (dateLastSeenError) {
                dateLastSeenError.textContent = 'Date last seen cannot be in the future.';
                dateLastSeenError.classList.add('visible');
            }
            if (dateLastSeenInput) {
                dateLastSeenInput.focus();
            }
            if (typeof window !== 'undefined') {
                window.scrollTo({ top: dateLastSeenInput ? dateLastSeenInput.getBoundingClientRect().top + window.scrollY - 20 : 0, behavior: 'smooth' });
            }
            return false;
        }

        if (dateValue === todayValue && timeValue) {
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const [hours, minutes] = timeValue.split(':').map(Number);
            const selectedMinutes = (hours || 0) * 60 + (minutes || 0);

            if (selectedMinutes > currentMinutes) {
                if (timeLastSeenInput) {
                    timeLastSeenInput.classList.add('input-invalid');
                }
                if (timeLastSeenError) {
                    timeLastSeenError.textContent = 'Time last seen cannot be later than the current time.';
                    timeLastSeenError.classList.add('visible');
                }
                if (timeLastSeenInput) {
                    timeLastSeenInput.focus();
                }
                if (typeof window !== 'undefined') {
                    window.scrollTo({ top: timeLastSeenInput ? timeLastSeenInput.getBoundingClientRect().top + window.scrollY - 20 : 0, behavior: 'smooth' });
                }
                return false;
            }
        }

        return true;
    }

    function validatePhoneValue(value, message, isRequired) {
        if (!value || !value.trim()) {
            return isRequired ? { valid: false, message } : { valid: true };
        }

        const trimmedValue = value.trim();
        const digitsOnly = trimmedValue.replace(/\D/g, '');
        const hasSupportedCharacters = /^[\d\s+().-]+$/.test(trimmedValue);
        const hasValidDigitCount = digitsOnly.length >= 6 && digitsOnly.length <= 15;
        const hasUnsupportedChars = !hasSupportedCharacters || !hasValidDigitCount;

        if (hasUnsupportedChars) {
            return { valid: false, message };
        }

        return { valid: true };
    }

    function validateEmailValue(value) {
        if (!value || !value.trim()) {
            return { valid: true };
        }

        const trimmedValue = value.trim();
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(trimmedValue)) {
            return { valid: false, message: 'Enter a valid email address.' };
        }

        return { valid: true };
    }

    function validateContactFields() {
        const contactPhoneValue = contactPhoneInput ? contactPhoneInput.value.trim() : '';
        const altPhoneValue = altPhoneInput ? altPhoneInput.value.trim() : '';
        const parentEmailValue = parentEmailInput ? parentEmailInput.value.trim() : '';

        const primaryPhoneValidation = validatePhoneValue(contactPhoneValue, 'Enter a valid phone number containing 6 to 15 digits.', true);
        if (!primaryPhoneValidation.valid) {
            if (contactPhoneInput) {
                contactPhoneInput.classList.add('input-invalid');
            }
            if (contactPhoneError) {
                contactPhoneError.textContent = primaryPhoneValidation.message;
                contactPhoneError.classList.add('visible');
            }
            if (contactPhoneInput) {
                contactPhoneInput.focus();
            }
            if (typeof window !== 'undefined') {
                window.scrollTo({ top: contactPhoneInput ? contactPhoneInput.getBoundingClientRect().top + window.scrollY - 20 : 0, behavior: 'smooth' });
            }
            return false;
        }

        const altPhoneValidation = { valid: true };
        if (!altPhoneValidation.valid) {
            if (altPhoneInput) {
                altPhoneInput.classList.add('input-invalid');
            }
            if (altPhoneError) {
                altPhoneError.textContent = altPhoneValidation.message;
                altPhoneError.classList.add('visible');
            }
            if (altPhoneInput) {
                altPhoneInput.focus();
            }
            if (typeof window !== 'undefined') {
                window.scrollTo({ top: altPhoneInput ? altPhoneInput.getBoundingClientRect().top + window.scrollY - 20 : 0, behavior: 'smooth' });
            }
            return false;
        }

        const emailValidation = validateEmailValue(parentEmailValue);
        if (!emailValidation.valid) {
            if (parentEmailInput) {
                parentEmailInput.classList.add('input-invalid');
            }
            if (parentEmailError) {
                parentEmailError.textContent = emailValidation.message;
                parentEmailError.classList.add('visible');
            }
            if (parentEmailInput) {
                parentEmailInput.focus();
            }
            if (typeof window !== 'undefined') {
                window.scrollTo({ top: parentEmailInput ? parentEmailInput.getBoundingClientRect().top + window.scrollY - 20 : 0, behavior: 'smooth' });
            }
            return false;
        }

        return true;
    }

    [contactPhoneInput, altPhoneInput, parentEmailInput].forEach((input) => {
        if (!input) {
            return;
        }

        input.addEventListener('input', () => {
            const errorElement = input.id === 'contactPhone'
                ? contactPhoneError
                : input.id === 'altPhone'
                    ? altPhoneError
                    : parentEmailError;

            clearValidationMessage(input, errorElement);
        });
    });

    [dateLastSeenInput, timeLastSeenInput].forEach((input) => {
        if (!input) {
            return;
        }

        input.addEventListener('input', () => {
            const errorElement = input.id === 'dateLastSeen'
                ? dateLastSeenError
                : timeLastSeenError;

            clearValidationMessage(input, errorElement);
        });
    });

    camBtn.addEventListener('click', async () => {
    try {
        const Camera = window.Capacitor.Plugins.Camera;

        const image = await Camera.getPhoto({
            quality: 55,
            allowEditing: false,
            resultType: 'dataUrl',
            source: 'CAMERA'
        });

        await prepareSelectedPhoto(image.dataUrl, 'Current photo taken today', false);

    } catch (err) {
        console.error(err);
        alert(
            "Camera Error\n\n" +
            "Name: " + err.name +
            "\nMessage: " + err.message
        );
    }
});

    

  galleryBtn.addEventListener('click', async () => {
    try {
        const Camera = window.Capacitor.Plugins.Camera;

        const image = await Camera.getPhoto({
            quality: 55,
            allowEditing: false,
            resultType: 'dataUrl',
            source: 'PHOTOS'
        });

        await prepareSelectedPhoto(image.dataUrl, 'Recent reference photo. See "Clothing When Last Seen" for the reported clothing description.', true);

    } catch (err) {
        console.error(err);
        alert(
            "Gallery Error\n\n" +
            "Name: " + err.name +
            "\nMessage: " + err.message
        );
    }
});
        function clearProgressTimers() {
            if (progressTimerOne) {
                clearTimeout(progressTimerOne);
                progressTimerOne = null;
            }

            if (progressTimerTwo) {
                clearTimeout(progressTimerTwo);
                progressTimerTwo = null;
            }
        }

        function showProgressStage(stageNumber) {
            const uploadStep = document.getElementById('progressUpload');
            const pdfStep = document.getElementById('progressPdf');
            const emailStep = document.getElementById('progressEmail');
            const completedStep = document.getElementById('progressCompleted');

            if (!uploadStep || !pdfStep || !emailStep || !completedStep) {
                return;
            }

            const steps = [uploadStep, pdfStep, emailStep, completedStep];

            steps.forEach((step, index) => {
                step.classList.remove('active', 'complete');

                if (index < stageNumber - 1) {
                    step.classList.add('complete');
                } else if (index === stageNumber - 1) {
                    step.classList.add('active');
                }
            });
        }

        function showCompletedProgress() {
            clearProgressTimers();

            const uploadStep = document.getElementById('progressUpload');
            const pdfStep = document.getElementById('progressPdf');
            const emailStep = document.getElementById('progressEmail');
            const completedStep = document.getElementById('progressCompleted');

            if (!uploadStep || !pdfStep || !emailStep || !completedStep) {
                return;
            }

            uploadStep.className = 'progress-step complete';
            pdfStep.className = 'progress-step complete';
            emailStep.className = 'progress-step complete';
            completedStep.className = 'progress-step complete';
        }
        function prepareSuccessSound() {
        try {
            const AudioContextClass =
                window.AudioContext || window.webkitAudioContext;

            if (!AudioContextClass) {
                return;
            }

            if (!successAudioContext) {
                successAudioContext = new AudioContextClass();
            }

            if (successAudioContext.state === "suspended") {
                successAudioContext.resume().catch(() => {});
            }
        } catch (error) {
            console.warn("Audio preparation unavailable:", error);
        }
    }

        function playSuccessSound() {
            try {
                if (!successAudioContext) {
                    return;
                }

                const currentTime = successAudioContext.currentTime;

                const oscillatorOne = successAudioContext.createOscillator();
                const gainOne = successAudioContext.createGain();

                oscillatorOne.type = "sine";
                oscillatorOne.frequency.setValueAtTime(660, currentTime);

                gainOne.gain.setValueAtTime(0.0001, currentTime);
                gainOne.gain.exponentialRampToValueAtTime(0.16, currentTime + 0.02);
                gainOne.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.18);

                oscillatorOne.connect(gainOne);
                gainOne.connect(successAudioContext.destination);

                oscillatorOne.start(currentTime);
                oscillatorOne.stop(currentTime + 0.2);

                const oscillatorTwo = successAudioContext.createOscillator();
                const gainTwo = successAudioContext.createGain();

                oscillatorTwo.type = "sine";
                oscillatorTwo.frequency.setValueAtTime(880, currentTime + 0.18);

                gainTwo.gain.setValueAtTime(0.0001, currentTime + 0.18);
                gainTwo.gain.exponentialRampToValueAtTime(0.16, currentTime + 0.2);
                gainTwo.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.42);

                oscillatorTwo.connect(gainTwo);
                gainTwo.connect(successAudioContext.destination);

                oscillatorTwo.start(currentTime + 0.18);
                oscillatorTwo.stop(currentTime + 0.44);

            } catch (error) {
                console.warn("Success sound unavailable:", error);
            }
        }
        function scrollToStatusBox() {
        const statusBox = document.getElementById('statusMessage');

        if (!statusBox) {
            return;
        }

        setTimeout(() => {
            statusBox.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }, 150);
    }
        function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onloadend = () => {
                if (typeof reader.result !== "string") {
                    reject(new Error("Unable to convert PDF to Base64."));
                    return;
                }

                const base64Data = reader.result.split(",")[1];

                if (!base64Data) {
                    reject(new Error("PDF Base64 data is empty."));
                    return;
                }

                resolve(base64Data);
            };

            reader.onerror = () => {
                reject(new Error("Unable to read generated PDF."));
            };

            reader.readAsDataURL(blob);
        });
    }
    async function saveGeneratedPdf(blob) {
        try {
            const Filesystem = window.Capacitor?.Plugins?.Filesystem;

            if (!Filesystem) {
                throw new Error("Filesystem plugin is unavailable.");
            }

            const base64Data = await blobToBase64(blob);

            const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-");

            const fileName =
                `Emergency_Broadcast_Alert_${timestamp}.pdf`;

            const savedFile = await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: "CACHE",
                recursive: true
            });

            lastSavedPdfName = fileName;
            lastSavedPdfPath = savedFile.uri;

            console.log("PDF saved locally:", savedFile.uri);

            return savedFile.uri;

        } catch (error) {
            console.error("Unable to save PDF locally:", error);

            lastSavedPdfName = "";
            lastSavedPdfPath = "";

            return "";
        }
    }
    async function openLastSavedPdf() {
        try {
            if (!lastSavedPdfPath) {
                alert("No saved PDF is available yet.");
                return;
            }

            const FileViewer = window.Capacitor?.Plugins?.FileViewer;

            if (!FileViewer) {
                alert("The PDF viewer is unavailable on this device.");
                return;
            }

            await FileViewer.openDocumentFromLocalPath({
                path: lastSavedPdfPath
            });

        } catch (error) {
            console.error("Unable to open saved PDF:", error);

            alert(
                "Unable to open the saved PDF.\n\n" +
                (error.message || "No compatible PDF viewer was found.")
            );
        }
    }
    async function exitFromTerms() {
        try {
            const App = window.Capacitor?.Plugins?.App;

            if (!App) {
                alert("Unable to exit the app on this device.");
                return;
            }

            await App.exitApp();
        } catch (error) {
            console.error("Unable to exit app:", error);
            alert("Unable to exit the app. Please close it from the recent apps screen.");
        }
    }

    function createRequestTimeout(controller, timeoutMilliseconds = 120000) {
    return setTimeout(() => {
        controller.abort();
    }, timeoutMilliseconds);
    }
        document.getElementById('broadcastForm').addEventListener('submit', async function(e) {
            e.preventDefault();

            const statusBox = document.getElementById('statusMessage');
            const generateBtn = document.getElementById('generateBtn');

            const trimmedContactPhone = contactPhoneInput ? contactPhoneInput.value.trim() : '';
            const trimmedAltPhone = altPhoneInput ? altPhoneInput.value.trim() : '';
            const trimmedParentEmail = parentEmailInput ? parentEmailInput.value.trim() : '';

            if (contactPhoneInput) {
                contactPhoneInput.value = trimmedContactPhone;
            }
            if (altPhoneInput) {
                altPhoneInput.value = trimmedAltPhone;
            }
            if (parentEmailInput) {
                parentEmailInput.value = trimmedParentEmail;
            }

            clearAllValidationMessages();
            setDateInputMax();

            if (!validateContactFields()) {
                return;
            }

            if (!validateDateTimeFields()) {
                return;
            }

            // Prevent duplicate submissions
            if (isSubmitting) {
                return;
            }
            if (isPreparingPhoto) {
                setStatusMessage('Preparing photo...');
                return;
            }

            if (!compressedPhotoBase64) {
            statusBox.style.color = '#d9534f';
            statusBox.innerText = "Error: Please capture or select a Child Photo first.";
            return;
        }
        isSubmitting = true;
        setSubmissionControlsDisabled(true);
        generateBtn.disabled = true;
        generateBtn.innerHTML =
            '<span class="loading-spinner"></span>Generating Broadcast...';
            prepareSuccessSound();
        statusBox.style.color = '#666';
        statusBox.innerHTML = `
            <div class="progress-panel">
                <div id="progressUpload" class="progress-step active">
                    🔒 Uploading Secure Data...
                </div>

                <div id="progressPdf" class="progress-step">
                    📄 Generating Broadcast PDF...
                </div>

                <div id="progressEmail" class="progress-step">
                    📧 Sending Parent Email...
                </div>

                <div id="progressCompleted" class="progress-step">
                    ✅ Completed
                </div>
            </div>
        `;

        clearProgressTimers();

        progressTimerOne = setTimeout(() => {
            showProgressStage(2);
        }, 1500);

        progressTimerTwo = setTimeout(() => {
            showProgressStage(3);
        }, 3500);
        const requestId = activeSubmissionRequestId || (
            (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        );

        if (!activeSubmissionRequestId) {
            activeSubmissionRequestId = requestId;
        }

        const payload = {
                child_name: document.getElementById('childName').value,
                age_gender: `${document.getElementById('childAge').value} / ${document.getElementById('childGender').value}`,
                parent_name: document.getElementById('parentName').value,
                reporting_agency: document.getElementById('reportingAgency').value || "Local Law Enforcement",
                phone: document.getElementById('contactPhone').value,
                alt_phone: document.getElementById('altPhone').value || "None designated",
                parent_email: document.getElementById('parentEmail').value || "None provided",
                full_address: document.getElementById('addressInput').value.trim(),
                date_last_seen: document.getElementById('dateLastSeen').value,
                time_last_seen: document.getElementById('timeLastSeen').value,
                shoes: document.getElementById('footwear').value || "Not provided",
                skin_tone: document.getElementById('skinTone').value || "Not provided",
                eye_color: document.getElementById('eyeColor').value || "Not provided",
                birth_marks: document.getElementById('birthmarks').value || "None noted",
                clothing_desc: document.getElementById('clothingDesc').value || "Not provided",
                electronics: document.getElementById('electronics').value || "None reported",
                pets_toys: document.getElementById('petsToys').value || "None reported",

                photo_context: document.getElementById('photoContext').value,

                compressed_photo: compressedPhotoBase64,
                lang: "en"
            };
            lastSubmittedPayload = payload;

        try {
            // Re-enable temporarily right before packaging payload so form validation naturally reads the value array
            photoContextDropdown.disabled = false;
 
            console.log("Calling backend...");
            const payloadSizeKB = Math.round(
                new Blob([JSON.stringify(payload)]).size / 1024
            );

            //alert("Payload size: " + payloadSizeKB + " KB");

           activeRequestController = new AbortController();

            const requestTimeout = createRequestTimeout(
                activeRequestController,
                120000
            );

            let response;
            let shouldRestoreControls = true;

            try {
                response = await fetch(
                    'https://child-safety-app.onrender.com/api/v1/generate-pass',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-SecurePass-Token': 'EfoGJHO-uS8j6b70hl-OfKbNXNcnNwq4ZLsGSB6736zq78c5FIzbvmuIDUaVGSzD',
                            'X-Request-ID': requestId                            //SP_ENTERPRISE_NATIVE_SECRET_TKEN_XYZ123
                        },
                        body: JSON.stringify(payload),
                        signal: activeRequestController.signal
                    }
                );
            } finally {
                clearTimeout(requestTimeout);
                activeRequestController = null;
                if (shouldRestoreControls) {
                    setSubmissionControlsDisabled(false);
                    if (generateBtn && generateBtn.innerText !== 'Broadcast Created ✓') {
                        generateBtn.innerText = 'Generate Broadcast Pass';
                    }
                }
            }

            console.log("Response received");

            // Re-lock dropdown view state back to disabled rule immediately following network handoff
            photoContextDropdown.disabled = true;

            if (response.status === 409) {
                shouldRestoreControls = false;
                isSubmitting = false;
                activeSubmissionRequestId = null;
                setSubmissionControlsDisabled(false);
                generateBtn.disabled = false;
                generateBtn.innerText = 'Generate Broadcast Pass';
                statusBox.style.color = '#d9534f';
                statusBox.innerText = 'This alert is already being generated. Please wait for the current request to finish.';
                scrollToStatusBox();
                return;
            }

            if (response.ok) {
                generateBtn.innerHTML = "Broadcast Created ✓";
                generateBtn.disabled = true;
                generateBtn.disabled = true;
                showCompletedProgress();
                playSuccessSound();

                await new Promise(resolve => setTimeout(resolve, 500));
                const blob = await response.blob();
                await saveGeneratedPdf(blob);
                const pdfFile = new File([blob], "Emergency_Broadcast_Alert.pdf", {
                    type: "application/pdf"
                });
                const fileURL = URL.createObjectURL(blob);

                const emailValue = document.getElementById('parentEmail').value.trim();
                const emailStatus = response.headers.get('X-Email-Status') || 'not_requested';

                window.open(fileURL, '_blank');

                statusBox.style.color = '#5cb85c';

                let emailMessage = "";
                if (emailValue && emailStatus === "sent") {
                    emailMessage = `✅ Copy sent to parent email: ${emailValue}<br>`;
                } else if (emailValue && emailStatus.startsWith("failed")) {
                    emailMessage = `⚠️ PDF generated, but email sending failed. Please use Share PDF.<br>`;
                } else {
                    emailMessage = `ℹ️ Parent email was not provided. Use Share PDF to send via WhatsApp, Messages/SMS, Email, AirDrop, or Files.<br>`;
                }

             statusBox.innerHTML = `
                <div style="font-size:20px; font-weight:bold; color:#2e7d32; margin-bottom:14px;">
                    ✅ Emergency Broadcast Created
                </div>

                <div style="text-align:left; display:inline-block; margin-bottom:12px; line-height:1.8;">
                    <div>✔ PDF Generated</div>
                    <div>${emailValue && emailStatus === "sent" ? "✔ Email Delivered" : emailMessage}</div>
                </div>

                <div style="margin:10px 0 6px; color:#444; font-weight:600;">
                    You can now:
                </div>
                <button
                    type="button"
                    id="viewPdfBtn"
                    class="submit-btn"
                    style="background:#28a745;">
                    View PDF
                </button>
                <button type="button" id="sharePdfBtn" class="submit-btn">
                    Share PDF
                </button>

                <button
                    type="button"
                    id="clearFormBtn"
                    class="submit-btn"
                    style="background:#6c757d;">
                    Create New Alert
                </button>

                <button
                    type="button"
                    id="backTermsBtn"
                    class="submit-btn"
                    style="background:#0275d8;">
                    Back to Terms
                </button>

                <button
                    type="button"
                    id="closeAppBtn"
                    class="submit-btn"
                    style="background:#444444;">
                    Close
                </button>
            `;
            scrollToStatusBox();
                    document.getElementById('viewPdfBtn').addEventListener('click', async () => {
                    await openLastSavedPdf();
                });
                document.getElementById('sharePdfBtn').addEventListener('click', async () => {
                try {
                    if (!lastSavedPdfPath) {
                        alert("No saved PDF is available to share.");
                        return;
                    }

                    const Share = window.Capacitor?.Plugins?.Share;

                    if (!Share) {
                        alert("Native sharing is unavailable on this device.");
                        return;
                    }

                    await Share.share({
                        title: "🚨 Child Safety Alert",
                        text:
                            "🚨 CHILD SAFETY ALERT\n\n" +
                            "Emergency Broadcast PDF attached.\n\n" +
                            "If you have information regarding this child, please contact the reporting agency immediately.\n\n" +
                            "Generated using SecurePass.",
                        files: [lastSavedPdfPath],
                        dialogTitle: "Share Emergency Broadcast"
                    });

                } catch (shareError) {
                    console.error("Unable to share PDF:", shareError);

                    alert(
                        "Unable to share the PDF.\n\n" +
                        (shareError.message || "Please try again.")
                    );
                }
            });

                document.getElementById('clearFormBtn').addEventListener('click', () => {
                    clearFormWithConfirmation();
                });

                document.getElementById('backTermsBtn').addEventListener('click', () => {
                    if (confirm("Go back to Terms? Your entered form data will remain unless you clear it.")) {
                        document.getElementById('legalOverlay').style.display = 'flex';
                        document.getElementById('broadcastForm').style.display = 'none';
                    }
                });

                document.getElementById('closeAppBtn').addEventListener('click', () => {
                    closeAppView();
                });
            } else {
            const errData = await response.json();
            clearProgressTimers();

            isSubmitting = false;
            generateBtn.disabled = false;
            generateBtn.innerText = "Generate Broadcast Pass";

            statusBox.style.color = '#d9534f';
            statusBox.innerText = `Server Error: ${errData.detail}`;
            scrollToStatusBox();
        }
        } 
        catch (error) {
            console.error(error);

            clearProgressTimers();

            isSubmitting = false;
            generateBtn.disabled = false;
            generateBtn.innerText = "Generate Broadcast Pass";

            if (error.name === "AbortError") {
                statusBox.style.color = '#d9534f';
                statusBox.innerHTML = `
                    <div style="font-weight:bold; margin-bottom:8px;">
                        The request is taking longer than expected. Please check your connection and try again.
                    </div>

                    <button
                        type="button"
                        id="retryRequestBtn"
                        class="submit-btn">
                        Retry
                    </button>

                    <button
                        type="button"
                        id="cancelRequestBtn"
                        class="submit-btn"
                        style="background:#6c757d;">
                        Cancel
                    </button>
                `;

                scrollToStatusBox();

                document
                    .getElementById('retryRequestBtn')
                    .addEventListener('click', () => {
                        document
                            .getElementById('broadcastForm')
                            .requestSubmit();
                    });

                document
                    .getElementById('cancelRequestBtn')
                    .addEventListener('click', () => {
                        statusBox.style.color = '#666';
                        statusBox.innerText =
                            "Request cancelled. Your form information has been kept.";
                    });

                return;
            }

            alert(
                "ERROR = " +
                error.name +
                " : " +
                error.message
            );

            statusBox.style.color = '#d9534f';
            statusBox.innerText =
                "Network Error: " + error.message;

            scrollToStatusBox();
        }
        
    });

        function clearFormWithConfirmation() {
            const confirmed = confirm(
                "Create another broadcast?\n\n" +
                "All current alert information will be cleared.\n\n" +
                "Press OK to create a new alert or Cancel to keep the current alert."
            );

            if (confirmed) {
                if (activeRequestController) {
                    activeRequestController.abort();
                    activeRequestController = null;
                }

            document.getElementById('broadcastForm').reset();
            compressedPhotoBase64 = "";
            isSubmitting = false;
            activeSubmissionRequestId = null;
            setSubmissionControlsDisabled(false);
           // let lastSavedPdfPath = "";
            //let lastSavedPdfName = "";
            clearProgressTimers();
            const generateBtn = document.getElementById('generateBtn');
            generateBtn.disabled = false;
            generateBtn.innerText = "Generate Broadcast Pass";

            photoContextDropdown.disabled = false;
            photoContextDropdown.value = "";
            if (photoClothingWarning) {
                photoClothingWarning.classList.remove('visible');
            }
            clearAllValidationMessages();
            photoPreviewBox.innerText = "No photo captured or selected";
            photoPreviewBox.style.backgroundImage = "none";
            photoPreviewBox.style.borderColor = "#cccccc";
            const statusBox = document.getElementById('statusMessage');
            statusBox.style.color = '#666';
            statusBox.innerText = "Ready to submit alert pass details.";
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
    function formHasData() {
        const fieldIds = [
            'childName',
            'childAge',
            'childGender',
            'skinTone',
            'eyeColor',
            'addressInput',
            'dateLastSeen',
            'timeLastSeen',
            'parentName',
            'reportingAgency',
            'contactPhone',
            'altPhone',
            'parentEmail',
            'clothingDesc',
            'footwear',
            'birthmarks',
            'electronics',
            'petsToys',
            'photoContext'
        ];

        const hasTextData = fieldIds.some(id => {
            const field = document.getElementById(id);

            if (!field) {
                return false;
            }

            return field.value.trim() !== '';
        });

        return hasTextData || Boolean(compressedPhotoBase64);
    }
    async function closeAppView() {
        let shouldClose = true;

        if (formHasData()) {
            shouldClose = confirm(
                "Discard current alert?\n\n" +
                "Any entered information that has not been saved elsewhere will be lost.\n\n" +
                "Press OK to discard and close, or Cancel to continue editing."
            );
        }

        if (!shouldClose) {
            return;
        }

        if (activeRequestController) {
            activeRequestController.abort();
            activeRequestController = null;
        }

        try {
            const App = window.Capacitor?.Plugins?.App;

            if (!App) {
                alert("Unable to exit the app on this device.");
                return;
            }

            await App.exitApp();
        } catch (error) {
            console.error("Unable to close app:", error);
            alert("Unable to close the app. Please close it from the recent apps screen.");
        }
    }

    document.getElementById('formClearBtn').addEventListener('click', clearFormWithConfirmation);

    document.getElementById('formBackTermsBtn').addEventListener('click', function() {
        if (confirm("Go back to Terms? Your entered form data will remain unless you clear it.")) {
            document.getElementById('legalOverlay').style.display = 'flex';
            document.getElementById('broadcastForm').style.display = 'none';
        }
    });

    document.getElementById('formCloseBtn').addEventListener('click', closeAppView);

  // Handle Accept Button
    document.getElementById('acceptBtn').addEventListener('click', function() {
        localStorage.setItem("termsAccepted", "true");
        document.getElementById('legalOverlay').style.display = 'none';
        document.getElementById('broadcastForm').style.display = 'block';
    });

    // Handle Exit App Button
    document.getElementById('cancelBtn').addEventListener('click', exitFromTerms);
    if (localStorage.getItem("termsAccepted") === "true") {
        document.getElementById('legalOverlay').style.display = 'none';
        document.getElementById('broadcastForm').style.display = 'block';
    } else {
        document.getElementById('legalOverlay').style.display = 'flex';
        document.getElementById('broadcastForm').style.display = 'none';
    }