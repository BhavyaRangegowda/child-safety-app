console.log("Capacitor =", window.Capacitor);
    console.log("Plugins =", window.Capacitor?.Plugins);
    console.log("Filesystem plugin =", window.Capacitor?.Plugins?.Filesystem);
    console.log("FileViewer plugin =", window.Capacitor?.Plugins?.FileViewer);
    let compressedPhotoBase64 = "";
    let isSubmitting = false;
    let progressTimerOne = null;
    let progressTimerTwo = null;
    let activeRequestController = null;
    let lastSubmittedPayload = null;
    let lastSavedPdfPath = "";
    let lastSavedPdfName = "";

    let successAudioContext = null;
    const addressInput = document.getElementById('addressInput');
    const autocompleteDropdown = document.getElementById('autocompleteDropdown');
    let debounceTimer;

    function acceptTerms() {
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
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`);
                const data = await response.json();
                if (data && data.length > 0) {
                    autocompleteDropdown.innerHTML = '';
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.innerText = item.display_name;
                        div.addEventListener('click', function() {
                            addressInput.value = item.display_name;
                            autocompleteDropdown.style.display = 'none';
                        });
                        autocompleteDropdown.appendChild(div);
                    });
                    autocompleteDropdown.style.display = 'block';
                } else {
                    autocompleteDropdown.style.display = 'none';
                }
            } catch (err) {
                console.error(err);
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
        camBtn.addEventListener('click', async () => {
    try {
        const Camera = window.Capacitor.Plugins.Camera;

        const image = await Camera.getPhoto({
            quality: 55,
            allowEditing: false,
            resultType: 'dataUrl',
            source: 'CAMERA'
        });

        compressedPhotoBase64 = image.dataUrl;

        photoPreviewBox.innerText = "";
        photoPreviewBox.style.backgroundImage = `url(${compressedPhotoBase64})`;
        photoPreviewBox.style.borderColor = "#5cb85c";

        photoContextDropdown.disabled = false;
        photoContextDropdown.value = "Current photo taken today";
        photoContextDropdown.disabled = true;

        if (photoClothingWarning) {
            photoClothingWarning.classList.remove('visible');
        }

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

        compressedPhotoBase64 = image.dataUrl;

        photoPreviewBox.innerText = "";
        photoPreviewBox.style.backgroundImage = `url(${compressedPhotoBase64})`;
        photoPreviewBox.style.borderColor = "#5cb85c";

        photoContextDropdown.disabled = false;
        photoContextDropdown.value = 'Recent reference photo. See "Clothing When Last Seen" for the reported clothing description.';
        photoContextDropdown.disabled = true;

        if (photoClothingWarning) {
            photoClothingWarning.classList.add('visible');
        }

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

            // Prevent duplicate submissions
            if (isSubmitting) {
                return;
            }
        if (!compressedPhotoBase64) {
            statusBox.style.color = '#d9534f';
            statusBox.innerText = "Error: Please capture or select a Child Photo first.";
            return;
        }
        isSubmitting = true;
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
        const payload = {
                child_name: document.getElementById('childName').value,
                age_gender: `${document.getElementById('childAge').value} / ${document.getElementById('childGender').value}`,
                parent_name: document.getElementById('parentName').value,
                reporting_agency: document.getElementById('reportingAgency').value || "Local Law Enforcement",
                phone: document.getElementById('contactPhone').value,
                alt_phone: document.getElementById('altPhone').value || "None designated",
                parent_email: document.getElementById('parentEmail').value || "None provided",
                full_address: document.getElementById('addressInput').value,
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
            console.log(JSON.stringify(payload));
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

            try {
                response = await fetch(
                    'https://child-safety-app.onrender.com/api/v1/generate-pass',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-SecurePass-Token': 'SP_ENTERPRISE_NATIVE_SECRET_TOKEN_XYZ123'
                        },
                        body: JSON.stringify(payload),
                        signal: activeRequestController.signal
                    }
                );
            } finally {
                clearTimeout(requestTimeout);
                activeRequestController = null;
            }

            console.log("Response received");

            // Re-lock dropdown view state back to disabled rule immediately following network handoff
            photoContextDropdown.disabled = true;

            if (response.ok) {
                generateBtn.innerHTML = "Broadcast Created ✓";
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
                        The request is taking longer than expected.
                    </div>

                    <div style="margin-bottom:12px;">
                        Check your internet connection, then retry or cancel.
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
        document.getElementById('legalOverlay').style.display = 'none';
        document.getElementById('broadcastForm').style.display = 'block';
    });

    // Handle Exit App Button
    document.getElementById('cancelBtn').addEventListener('click', exitFromTerms);
