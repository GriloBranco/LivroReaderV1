document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const videoFileInput = document.getElementById('videoFile');
    const frameIntervalInput = document.getElementById('frameInterval');
    const promptInput = document.getElementById('prompt');
    const processButton = document.getElementById('processButton');
    const statusDiv = document.getElementById('status');
    const extractedTextPre = document.getElementById('extractedText');
    const downloadPdfButton = document.getElementById('downloadPdfButton');

    const videoPlayer = document.getElementById('videoPlayer');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    let allExtractedTexts = [];

    processButton.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const videoFile = videoFileInput.files[0];
        const frameInterval = parseFloat(frameIntervalInput.value);
        const customPrompt = promptInput.value.trim();

        if (!apiKey) {
            statusDiv.textContent = 'Erro: Por favor, insira sua chave API Gemini.';
            statusDiv.style.color = 'red';
            return;
        }
        if (!videoFile) {
            statusDiv.textContent = 'Erro: Por favor, selecione um arquivo de vídeo.';
            statusDiv.style.color = 'red';
            return;
        }
        if (isNaN(frameInterval) || frameInterval <= 0) {
            statusDiv.textContent = 'Erro: Intervalo entre frames inválido.';
            statusDiv.style.color = 'red';
            return;
        }

        processButton.disabled = true;
        extractedTextPre.textContent = '';
        downloadPdfButton.style.display = 'none';
        allExtractedTexts = [];
        statusDiv.textContent = 'Carregando vídeo...';
        statusDiv.style.color = 'black';

        const reader = new FileReader();
        reader.onload = (e) => {
            videoPlayer.src = e.target.result;
            videoPlayer.onloadedmetadata = async () => {
                statusDiv.textContent = `Vídeo carregado. Duração: ${videoPlayer.duration.toFixed(2)}s. Processando frames...`;
                await extractFramesAndProcess(videoPlayer, frameInterval, apiKey, customPrompt);
            };
            videoPlayer.onerror = () => {
                statusDiv.textContent = 'Erro ao carregar o vídeo.';
                statusDiv.style.color = 'red';
                processButton.disabled = false;
            }
        };
        reader.readAsDataURL(videoFile);
    });

    function cleanApiResponse(rawText) {
        if (!rawText) return "";

        let cleanedText = rawText;
        const unwantedPhrases = [
            "Claro, aqui está o texto destacado em laranja da imagem fornecida, com cada trecho em uma nova linha:",
            "Claro, aqui está o texto destacado em laranja da imagem:",
            "A primeira linha de texto destacada em laranja é ilegível.",
            "A segunda linha de texto destacada em laranja é ilegível.",
            "Entendido. Aqui está o texto destacado em laranja da imagem:",
            "Aqui está o texto destacado em laranja:",
            // Adicione outras frases que você notar que se repetem
        ];

        unwantedPhrases.forEach(phrase => {
            // Usar uma RegExp para substituição case-insensitive e global
            const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            cleanedText = cleanedText.replace(regex, '').trim();
        });

        // Remover linhas que contenham apenas "—", "---" ou que sejam vazias após a limpeza
        // Também remove espaços em branco no início/fim de cada linha útil
        cleanedText = cleanedText.split('\n')
            .map(line => line.trim())
            .filter(line => line !== "" && !/^—+$/.test(line))
            .join('\n');

        return cleanedText;
    }


    async function extractFramesAndProcess(video, interval, apiKey, customPrompt) {
        let currentTime = 0;
        const duration = video.duration;
        let frameCount = 0;

        video.muted = true;

        return new Promise(async (resolve) => {
            async function processNextFrame() {
                if (currentTime >= duration && frameCount > 0) { // Adicionado frameCount > 0 para garantir que ao menos um processamento tentou ocorrer
                    statusDiv.textContent = `Processamento concluído! ${frameCount} frames analisados.`;
                    processButton.disabled = false;
                    if(allExtractedTexts.length > 0) {
                        downloadPdfButton.style.display = 'block';
                    }
                    resolve();
                    return;
                }
                if (currentTime >= duration && frameCount === 0) { // Caso especial: vídeo muito curto ou intervalo muito grande
                    statusDiv.textContent = `Vídeo muito curto ou intervalo muito grande. Nenhum frame processado. Duração: ${duration.toFixed(2)}s`;
                    processButton.disabled = false;
                    resolve();
                    return;
                }


                video.currentTime = currentTime;

                video.onseeked = async () => {
                    frameCount++;
                    statusDiv.textContent = `Processando frame ${frameCount} (tempo: ${currentTime.toFixed(2)}s / ${duration.toFixed(2)}s)...`;

                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageDataUrl = canvas.toDataURL('image/jpeg');

                    try {
                        const rawTextFromApi = await callGeminiAPI(imageDataUrl, apiKey, customPrompt);
                        const highlightedText = cleanApiResponse(rawTextFromApi);

                        if (highlightedText && highlightedText.trim() !== "") {
                            extractedTextPre.textContent += highlightedText + '\n\n'; // Adiciona duas quebras de linha para separar blocos
                            allExtractedTexts.push(highlightedText);
                        }
                    } catch (error) {
                        console.error(`Erro ao processar frame em ${currentTime.toFixed(2)}s:`, error);
                        extractedTextPre.textContent += `Erro ao processar frame em ${currentTime.toFixed(2)}s: ${error.message}\n\n`;
                        // Se for erro de quota, podemos parar o processo para não continuar batendo na API
                        if (error.message && error.message.includes("429")) {
                             statusDiv.textContent = `Erro de quota da API (429). Tente aumentar o intervalo entre frames ou aguarde. Processamento interrompido.`;
                             processButton.disabled = false;
                             resolve(); // Interrompe o processamento
                             return;
                        }
                    }

                    currentTime += interval;
                    // Aumentamos o delay para 3 segundos para tentar evitar o erro de quota
                    setTimeout(processNextFrame, 3000);
                };
                 if (video.seeking === false && video.currentTime === currentTime) {
                     video.onseeked();
                }
            }
            // Para o primeiro frame, precisamos garantir que o 'onseeked' seja chamado
            // ou que o vídeo esteja pronto. Uma pequena espera pode ajudar.
             if (video.readyState >= 2) { // HAVE_CURRENT_DATA - o suficiente para o frame atual
                processNextFrame();
            } else {
                video.oncanplay = () => { // Espera até que o vídeo possa ser reproduzido/buscado
                    processNextFrame();
                    video.oncanplay = null; // Remove o listener para não disparar múltiplas vezes
                }
            }
        });
    }

    async function callGeminiAPI(imageDataUrl, apiKey, prompt) {
        const base64ImageData = imageDataUrl.split(',')[1];
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

        const requestBody = {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: base64ImageData
                        }
                    }
                ]
            }],
             generationConfig: {
                 temperature: 0.1, // Temperatura ainda mais baixa para ser mais direto
                 maxOutputTokens: 4096, // Aumentado um pouco, caso haja muito texto na página
             }
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Erro da API:", errorData);
            throw new Error(`API Error: ${response.status} ${response.statusText}. ${errorData.error?.message || 'Erro desconhecido da API.'}`);
        }

        const data = await response.json();

        if (data.candidates && data.candidates.length > 0 &&
            data.candidates[0].content && data.candidates[0].content.parts &&
            data.candidates[0].content.parts.length > 0 && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        } else {
            console.warn("Resposta da API inesperada ou sem texto:", data);
            if (data.candidates && data.candidates.length > 0 && data.candidates[0].finishReason) {
                // Se a API bloqueou por safety ou outro motivo, isso pode ser útil
                console.warn("Motivo do término da API:", data.candidates[0].finishReason);
                if (data.candidates[0].finishReason === "SAFETY") {
                    return "RESPOSTA BLOQUEADA POR POLÍTICA DE SEGURANÇA DA API.";
                }
            }
            return "";
        }
    }

    downloadPdfButton.addEventListener('click', () => {
        if (allExtractedTexts.length === 0) {
            alert("Nenhum texto foi extraído para gerar o PDF.");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        let yPosition = 15;
        const pageHeight = doc.internal.pageSize.height;
        const margin = 15;
        const lineHeight = 7; // Ajuste para espaçamento entre linhas

        doc.setFontSize(18);
        doc.text("Destaques do Livro", doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
        yPosition += 15;
        doc.setFontSize(12);

        allExtractedTexts.forEach(textBlock => {
            // Remove quebras de linha extras entre os blocos antes de dividir
            const cleanTextBlock = textBlock.trim();
            if (cleanTextBlock === "") return; // Pula blocos vazios

            const lines = doc.splitTextToSize(cleanTextBlock, doc.internal.pageSize.width - (2 * margin));

            // Verifica se há espaço suficiente para o bloco de texto, senão adiciona nova página
            const blockHeight = lines.length * lineHeight;
            if (yPosition + blockHeight > pageHeight - margin) {
                doc.addPage();
                yPosition = margin;
                 // Adiciona título na nova página também se desejar
                doc.setFontSize(18);
                doc.text("Destaques do Livro (continuação)", doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
                yPosition += 15;
                doc.setFontSize(12);
            }

            lines.forEach(line => {
                doc.text(line, margin, yPosition);
                yPosition += lineHeight;
            });
            yPosition += (lineHeight / 2); // Espaço extra menor entre blocos de texto
        });

        doc.save('destaques_livro.pdf');
    });
});
