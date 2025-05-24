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

    let allExtractedTexts = []; // Para armazenar todos os textos para o PDF

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

    async function extractFramesAndProcess(video, interval, apiKey, customPrompt) {
        let currentTime = 0;
        const duration = video.duration;
        let frameCount = 0;

        video.muted = true; // Evita que o som do vídeo toque durante o processamento

        return new Promise(async (resolve) => {
            async function processNextFrame() {
                if (currentTime >= duration) {
                    statusDiv.textContent = `Processamento concluído! ${frameCount} frames analisados.`;
                    processButton.disabled = false;
                    if(allExtractedTexts.length > 0) {
                        downloadPdfButton.style.display = 'block';
                    }
                    resolve();
                    return;
                }

                video.currentTime = currentTime;

                // Esperar o vídeo buscar o frame correto
                video.onseeked = async () => {
                    frameCount++;
                    statusDiv.textContent = `Processando frame ${frameCount} (tempo: ${currentTime.toFixed(2)}s / ${duration.toFixed(2)}s)...`;

                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageDataUrl = canvas.toDataURL('image/jpeg'); // Ou 'image/png'

                    try {
                        const highlightedText = await callGeminiAPI(imageDataUrl, apiKey, customPrompt);
                        if (highlightedText && highlightedText.trim() !== "") {
                            extractedTextPre.textContent += highlightedText + '\n\n';
                            allExtractedTexts.push(highlightedText);
                        }
                    } catch (error) {
                        console.error('Erro na API Gemini:', error);
                        extractedTextPre.textContent += `Erro ao processar frame em ${currentTime.toFixed(2)}s: ${error.message}\n\n`;
                    }

                    currentTime += interval;
                    // Pequeno delay para não sobrecarregar a UI/API, e para dar tempo do onseeked ser chamado novamente
                    setTimeout(processNextFrame, 100);
                };
                 // Se o currentTime já for o desejado, o evento 'onseeked' pode não disparar em alguns navegadores
                // para o primeiro frame, então disparamos manualmente se for o caso (ou se o vídeo já estiver pausado ali)
                if (video.seeking === false && video.currentTime === currentTime) {
                     video.onseeked();
                }
            }
            processNextFrame(); // Inicia o processamento do primeiro frame
        });
    }

    async function callGeminiAPI(imageDataUrl, apiKey, prompt) {
        // A API espera apenas os dados base64, sem o prefixo "data:image/jpeg;base64,"
        const base64ImageData = imageDataUrl.split(',')[1];

        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
        // Para o Gemini 1.5 Pro Vision (pode ser mais lento/custoso no free tier, mas mais capaz):
        // const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
        // Ou o antigo gemini-pro-vision:
        // const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`;


        const requestBody = {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: "image/jpeg", // ou "image/png" se você usar toDataURL('image/png')
                            data: base64ImageData
                        }
                    }
                ]
            }],
            // Opcional: Configurações de geração e segurança
             generationConfig: {
                 temperature: 0.2, // Baixa temperatura para respostas mais factuais/diretas
                 maxOutputTokens: 2048,
             },
            // safetySettings: [ // Exemplo, ajuste conforme necessidade
            //    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            //    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            //    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            //    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            // ]
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
            throw new Error(`API Error: ${response.status} ${response.statusText}. ${errorData.error?.message || ''}`);
        }

        const data = await response.json();

        // Verificar a estrutura da resposta da API Gemini
        if (data.candidates && data.candidates.length > 0 &&
            data.candidates[0].content && data.candidates[0].content.parts &&
            data.candidates[0].content.parts.length > 0 && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        } else {
            console.warn("Resposta da API inesperada ou sem texto:", data);
            return ""; // Retorna string vazia se não encontrar texto
        }
    }

    // Função para gerar PDF
    downloadPdfButton.addEventListener('click', () => {
        if (allExtractedTexts.length === 0) {
            alert("Nenhum texto foi extraído para gerar o PDF.");
            return;
        }

        const { jsPDF } = window.jspdf; // Acessa a biblioteca jsPDF do objeto window
        const doc = new jsPDF();
        let yPosition = 15; // Posição Y inicial no PDF
        const pageHeight = doc.internal.pageSize.height;
        const margin = 15;

        doc.setFontSize(18);
        doc.text("Destaques do Livro", doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
        yPosition += 15;
        doc.setFontSize(12);


        allExtractedTexts.forEach(textBlock => {
            const lines = doc.splitTextToSize(textBlock, doc.internal.pageSize.width - (2 * margin));
            lines.forEach(line => {
                if (yPosition + 10 > pageHeight - margin) { // Adicionar nova página se necessário (+10 para altura da linha)
                    doc.addPage();
                    yPosition = margin;
                }
                doc.text(line, margin, yPosition);
                yPosition += 7; // Espaçamento entre linhas
            });
            yPosition += 5; // Espaço extra entre blocos de texto
        });

        doc.save('destaques_livro.pdf');
    });

});