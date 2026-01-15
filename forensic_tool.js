// ============================================
// OpenCV.js Loader y Configuración
// ============================================

var cvReady = false;
var cvLoadError = false;

// Configuración de OpenCV.js con manejo de memoria mejorado
var Module = {
    onRuntimeInitialized: function() {
        cvReady = true;
        const badge = document.getElementById('cvStatus');
        if (badge) {
            badge.textContent = 'Motor Listo';
            badge.classList.remove('status-loading');
            badge.classList.add('status-ready');
        }
        console.log('OpenCV.js cargado correctamente');
    },
    onAbort: function(msg) {
        console.error('OpenCV.js abort:', msg);
        cvLoadError = true;
        const badge = document.getElementById('cvStatus');
        if (badge) {
            badge.textContent = 'Error de Carga';
            badge.classList.remove('status-loading');
            badge.classList.add('status-error');
        }
    },
    // Configuración de memoria para mejor rendimiento
    TOTAL_MEMORY: 256 * 1024 * 1024, // 256MB inicial
    MAXIMUM_MEMORY: 512 * 1024 * 1024 // 512MB máximo
};

// Función para cargar OpenCV.js con múltiples fallbacks
function loadOpenCV() {
    const opencvSources = [
        'https://docs.opencv.org/4.5.4/opencv.js',
        'https://cdn.jsdelivr.net/npm/opencv.js@1.2.1/dist/opencv.js',
        'https://unpkg.com/opencv.js@1.2.1/dist/opencv.js'
    ];
    
    function tryLoad(index) {
        if (index >= opencvSources.length) {
            console.error('No se pudo cargar OpenCV.js desde ninguna fuente');
            cvLoadError = true;
            const badge = document.getElementById('cvStatus');
            if (badge) {
                badge.textContent = 'Error de Carga';
                badge.classList.remove('status-loading');
                badge.classList.add('status-error');
            }
            return;
        }
        
        const script = document.createElement('script');
        script.src = opencvSources[index];
        script.async = true;
        script.onerror = () => {
            console.warn(`Falló carga desde ${opencvSources[index]}, intentando siguiente...`);
            tryLoad(index + 1);
        };
        script.onload = () => {
            console.log(`OpenCV.js cargado desde ${opencvSources[index]}`);
        };
        document.head.appendChild(script);
    }
    
    tryLoad(0);
}

// Iniciar carga cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadOpenCV);
} else {
    loadOpenCV();
}

// ============================================
// Aplicación Principal
// ============================================

// Referencias a elementos del DOM
const imageInput = document.getElementById('imageInput');
const residualCanvas = document.getElementById('residualCanvas');
const fftCanvas = document.getElementById('fftCanvas');
const chromaCanvas = document.getElementById('chromaCanvas');

const saturation = document.getElementById('saturation');
const contrast = document.getElementById('contrast');
const hueRotate = document.getElementById('hueRotate');
const resetBtn = document.getElementById('resetBtn');

const fftGamma = document.getElementById('fftGamma');
const fftGain = document.getElementById('fftGain');
const fftOffset = document.getElementById('fftOffset');
const resetFftBtn = document.getElementById('resetFftBtn');

const rctx = residualCanvas.getContext('2d');
const cctx = chromaCanvas.getContext('2d');
const fctx = fftCanvas.getContext('2d');
const loader = document.getElementById('loader');

// Configuración de límites de recursos
const MAX_IMAGE_DIMENSION = 2048; // Máximo 2048px en cualquier dimensión
const MAX_PIXELS = 4194304; // ~4MP (2048x2048) para prevenir problemas de memoria
const PROCESSING_DEBOUNCE_MS = 150; // Debounce más largo para mejor rendimiento

// Variables de estado
let originalImg = null;
let processedImg = null; // Imagen redimensionada para procesamiento
let isProcessing = false;
let pendingRequest = false;
let debounceTimer = null;
let resizeTimer = null;

// ============================================
// Funciones de Utilidad
// ============================================

const updateText = (id, val, suffix) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val + suffix;
};

const renderMatToCanvas = (mat, canvas, interpolation = null) => {
    if (!mat || !canvas) return;
    const interp = interpolation ?? cv.INTER_AREA;
    const targetWidth = Math.max(1, Math.round(canvas.width));
    const targetHeight = Math.max(1, Math.round(canvas.height));
    if (mat.cols === targetWidth && mat.rows === targetHeight) {
        cv.imshow(canvas.id, mat);
        return;
    }
    const resized = new cv.Mat();
    cv.resize(mat, resized, new cv.Size(targetWidth, targetHeight), 0, 0, interp);
    cv.imshow(canvas.id, resized);
    resized.delete();
};

/**
 * Redimensiona una imagen manteniendo el aspect ratio
 * para prevenir problemas de memoria
 * Retorna una promesa que resuelve con la imagen (redimensionada o original)
 */
function resizeImageIfNeeded(img, maxDimension = MAX_IMAGE_DIMENSION) {
    return new Promise((resolve, reject) => {
        const pixels = img.width * img.height;
        
        // Si la imagen es pequeña, no necesita redimensionarse
        if (img.width <= maxDimension && img.height <= maxDimension && pixels <= MAX_PIXELS) {
            resolve({ img: img, wasResized: false });
            return;
        }
        
        // Calcular nuevo tamaño manteniendo aspect ratio
        let newWidth = img.width;
        let newHeight = img.height;
        
        if (img.width > img.height) {
            if (img.width > maxDimension) {
                newWidth = maxDimension;
                newHeight = Math.round((img.height / img.width) * maxDimension);
            }
        } else {
            if (img.height > maxDimension) {
                newHeight = maxDimension;
                newWidth = Math.round((img.width / img.height) * maxDimension);
            }
        }
        
        // Asegurar que no exceda MAX_PIXELS
        if (newWidth * newHeight > MAX_PIXELS) {
            const scale = Math.sqrt(MAX_PIXELS / (newWidth * newHeight));
            newWidth = Math.round(newWidth * scale);
            newHeight = Math.round(newHeight * scale);
        }
        
        // Crear canvas temporal para redimensionar
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = newWidth;
        tempCanvas.height = newHeight;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Usar alta calidad para el redimensionamiento
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        tempCtx.drawImage(img, 0, 0, newWidth, newHeight);
        
        // Crear nueva imagen desde el canvas
        const resizedImg = new Image();
        resizedImg.onload = () => {
            resolve({ img: resizedImg, wasResized: true });
        };
        resizedImg.onerror = () => {
            reject(new Error('Error al redimensionar imagen'));
        };
        resizedImg.src = tempCanvas.toDataURL('image/png');
    });
}

/**
 * Muestra información sobre la imagen cargada
 */
function showImageInfo(img, wasResized = false) {
    const infoEl = document.getElementById('imageInfo');
    const warningEl = document.getElementById('imageWarning');
    
    if (infoEl) {
        const sizeMB = ((img.width * img.height * 4) / (1024 * 1024)).toFixed(2);
        infoEl.textContent = `${img.width}×${img.height}px (${sizeMB}MB)`;
        if (wasResized) {
            infoEl.textContent += ' [Redimensionada]';
        }
        infoEl.classList.remove('hidden');
    }
    
    if (warningEl && wasResized) {
        warningEl.textContent = `Imagen redimensionada a ${img.width}×${img.height}px para optimizar rendimiento`;
        warningEl.classList.remove('hidden');
    } else if (warningEl) {
        warningEl.classList.add('hidden');
    }
}

// ============================================
// Funciones de Procesamiento
// ============================================

const applyChromaFilters = () => {
    if (!originalImg) return;
    
    updateText('satValue', saturation.value, '%');
    updateText('conValue', contrast.value, '%');
    updateText('hueValue', hueRotate.value, '°');

    const containerWidth = chromaCanvas.parentElement.clientWidth;
    const scale = containerWidth / originalImg.width;
    chromaCanvas.width = originalImg.width * scale;
    chromaCanvas.height = originalImg.height * scale;

    cctx.filter = `saturate(${saturation.value}%) contrast(${contrast.value}%) hue-rotate(${hueRotate.value}deg)`;
    cctx.drawImage(originalImg, 0, 0, chromaCanvas.width, chromaCanvas.height);
};

const requestProcessing = () => {
    if (!processedImg || !cvReady) {
        if (!cvReady) {
            console.warn('OpenCV.js aún no está listo');
        }
        return;
    }
    
    // Cancelar procesamiento pendiente
    if (debounceTimer) clearTimeout(debounceTimer);
    
    debounceTimer = setTimeout(() => {
        if (isProcessing) {
            pendingRequest = true;
            return;
        }
        processAdvancedForensics(processedImg);
    }, PROCESSING_DEBOUNCE_MS);
};

const updateFftValues = () => {
    updateText('fftGammaVal', fftGamma.value, '');
    updateText('fftGainVal', fftGain.value, '');
    updateText('fftOffsetVal', fftOffset.value, '');
    requestProcessing();
};

/**
 * Motor de procesamiento forense optimizado
 * Mejoras:
 * - Gestión mejorada de memoria
 * - Limpieza agresiva de recursos
 * - Manejo seguro de punteros ROI
 * - Prevención de memory leaks
 */
function processAdvancedForensics(img) {
    if (!cvReady || typeof cv === 'undefined' || !cv.Mat || isProcessing) {
        if (!cvReady) {
            console.warn('OpenCV.js no está listo aún');
        }
        return;
    }

    if (isProcessing) {
        pendingRequest = true;
        return;
    }

    isProcessing = true;
    const startTime = performance.now();
    
    // Array para rastrear todos los recursos que deben limpiarse
    let matsToClean = [];
    let vectorsToClean = [];
    let objectsToClean = [];
    
    try {
        // Validar que la imagen es válida
        if (!img || img.width === 0 || img.height === 0) {
            throw new Error('Imagen inválida');
        }
        
        console.log(`Procesando imagen: ${img.width}x${img.height}px`);
        
        // Entrada - leer imagen
        let src = cv.imread(img);
        if (!src || src.empty()) {
            throw new Error('No se pudo leer la imagen');
        }
        matsToClean.push(src);
        
        // Convertir a escala de grises
        let gray = new cv.Mat();
        matsToClean.push(gray);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        
        // Liberar src temprano si ya no se necesita
        src.delete();
        matsToClean = matsToClean.filter(m => m !== src);

        // Residual Espacial
        let blurred = new cv.Mat(); 
        matsToClean.push(blurred);
        let residual = new cv.Mat(); 
        matsToClean.push(residual);
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
        cv.absdiff(gray, blurred, residual); 
        
        // Preparar residual visual
        let visualResidual = new cv.Mat();
        matsToClean.push(visualResidual);
        residual.convertTo(visualResidual, -1, 35.0, 0);
        
        // Aplicar CLAHE para mejorar contraste
        let clahe = new cv.CLAHE(20.0, new cv.Size(8, 8));
        objectsToClean.push(clahe);
        clahe.apply(visualResidual, visualResidual);
        
        // Mostrar residual en canvas
        const residualContainer = residualCanvas.parentElement;
        // Si estamos en pantalla completa, mantener el tamaño del canvas o calcularlo basándose en la ventana
        if (document.fullscreenElement === residualContainer) {
            // En pantalla completa, calcular tamaño basándose en la ventana
            const maxWidth = window.innerWidth * 0.95;
            const maxHeight = window.innerHeight * 0.95;
            const aspectRatio = visualResidual.cols / visualResidual.rows;
            
            let newWidth, newHeight;
            if (maxWidth / maxHeight > aspectRatio) {
                newHeight = maxHeight;
                newWidth = newHeight * aspectRatio;
            } else {
                newWidth = maxWidth;
                newHeight = newWidth / aspectRatio;
            }
            
            residualCanvas.width = Math.round(newWidth);
            residualCanvas.height = Math.round(newHeight);
        } else {
            // Tamaño normal basado en el contenedor
            residualCanvas.width = residualContainer.clientWidth;
            residualCanvas.height = (residualContainer.clientWidth / visualResidual.cols) * visualResidual.rows;
        }
        renderMatToCanvas(visualResidual, residualCanvas, cv.INTER_AREA);

        // FFT Prep
        let optimalRows = cv.getOptimalDFTSize(residual.rows);
        let optimalCols = cv.getOptimalDFTSize(residual.cols);
        let padded = new cv.Mat(); 
        matsToClean.push(padded);
        cv.copyMakeBorder(residual, padded, 0, optimalRows - residual.rows, 0, optimalCols - residual.cols, cv.BORDER_CONSTANT, new cv.Scalar(0));

        // Preparar planos complejos para FFT
        let planes = new cv.MatVector();
        vectorsToClean.push(planes);
        
        let plane0 = new cv.Mat();
        matsToClean.push(plane0);
        padded.convertTo(plane0, cv.CV_32F);
        
        let plane1 = cv.Mat.zeros(padded.rows, padded.cols, cv.CV_32F);
        matsToClean.push(plane1);
        
        planes.push_back(plane0);
        planes.push_back(plane1);
        
        // Crear matriz compleja
        let complexI = new cv.Mat();
        matsToClean.push(complexI);
        cv.merge(planes, complexI);

        // Cálculo FFT
        cv.dft(complexI, complexI);
        
        // Reutilizar planes para magnitud
        cv.split(complexI, planes);
        let realPlane = planes.get(0);
        let imagPlane = planes.get(1);
        
        // Calcular magnitud (resultado en realPlane)
        cv.magnitude(realPlane, imagPlane, realPlane);
        let mag = realPlane;

        // Escala Logarítmica para visualización
        let ones = cv.Mat.ones(mag.rows, mag.cols, mag.type());
        matsToClean.push(ones);
        cv.add(mag, ones, mag);
        cv.log(mag, mag);

        // INTERCAMBIO DE CUADRANTES (Método ultra-seguro)
        let cx = Math.floor(mag.cols / 2);
        let cy = Math.floor(mag.rows / 2);

        let shiftedMag = new cv.Mat(mag.rows, mag.cols, mag.type()); 
        matsToClean.push(shiftedMag);

        // Usamos copias independientes para evitar que headers de ROI se invaliden
        let roi0 = mag.roi(new cv.Rect(0, 0, cx, cy));
        let roi1 = mag.roi(new cv.Rect(cx, 0, cx, cy));
        let roi2 = mag.roi(new cv.Rect(0, cy, cx, cy));
        let roi3 = mag.roi(new cv.Rect(cx, cy, cx, cy));

        let target0 = shiftedMag.roi(new cv.Rect(cx, cy, cx, cy));
        let target1 = shiftedMag.roi(new cv.Rect(0, cy, cx, cy));
        let target2 = shiftedMag.roi(new cv.Rect(cx, 0, cx, cy));
        let target3 = shiftedMag.roi(new cv.Rect(0, 0, cx, cy));

        roi0.copyTo(target0); 
        roi1.copyTo(target1);
        roi2.copyTo(target2);
        roi3.copyTo(target3);

        // Limpiar headers de ROI inmediatamente
        roi0.delete(); roi1.delete(); roi2.delete(); roi3.delete();
        target0.delete(); target1.delete(); target2.delete(); target3.delete();

        // Normalización y Controles Dinámicos
        cv.normalize(shiftedMag, shiftedMag, 0, 1, cv.NORM_MINMAX, cv.CV_32F);
        
        const g = parseFloat(fftGamma.value);
        const br = parseFloat(fftGain.value);
        const off = parseFloat(fftOffset.value);

        cv.pow(shiftedMag, g, shiftedMag); 
        shiftedMag.convertTo(shiftedMag, cv.CV_8U, br * 255, off); 
        
        // Mostrar resultados
        const fftSize = fftCanvas.parentElement.clientWidth;
        fftCanvas.width = fftSize;
        fftCanvas.height = fftSize;
        renderMatToCanvas(shiftedMag, fftCanvas, cv.INTER_NEAREST);

    } catch (err) {
        console.error("Error crítico en procesamiento OpenCV:", err);
        const badge = document.getElementById('cvStatus');
        if (badge) {
            badge.textContent = 'Error';
            badge.classList.remove('status-ready', 'status-loading');
            badge.classList.add('status-error');
        }
        alert('Error al procesar la imagen. Por favor, intente con otra imagen o reduzca su tamaño.');
    } finally {
        // Limpieza agresiva de todos los recursos
        try {
            // Limpiar matrices
            matsToClean.forEach(m => {
                try {
                    if (m && typeof m.delete === 'function' && !m.isDeleted()) {
                        m.delete();
                    }
                } catch (e) {
                    console.warn('Error al limpiar matriz:', e);
                }
            });
            
            // Limpiar vectores
            vectorsToClean.forEach(v => {
                try {
                    if (v && typeof v.delete === 'function' && !v.isDeleted()) {
                        v.delete();
                    }
                } catch (e) {
                    console.warn('Error al limpiar vector:', e);
                }
            });
            
            // Limpiar objetos
            objectsToClean.forEach(o => {
                try {
                    if (o && typeof o.delete === 'function') {
                        o.delete();
                    }
                } catch (e) {
                    console.warn('Error al limpiar objeto:', e);
                }
            });
        } catch (cleanupError) {
            console.error('Error durante limpieza:', cleanupError);
        }
        
        const endTime = performance.now();
        console.log(`Procesamiento completado en ${(endTime - startTime).toFixed(2)}ms`);
        
        isProcessing = false;
        
        // Procesar solicitud pendiente si existe
        if (pendingRequest) {
            pendingRequest = false;
            // Pequeño delay para permitir que la memoria se libere
            setTimeout(() => {
                requestProcessing();
            }, 100);
        }
    }
}

// ============================================
// Event Listeners
// ============================================

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
        alert('Por favor, seleccione un archivo de imagen válido');
        return;
    }

    // Validar tamaño de archivo (máximo 50MB)
    if (file.size > 50 * 1024 * 1024) {
        alert('El archivo es demasiado grande. Por favor, use una imagen menor a 50MB');
        return;
    }

    const reader = new FileReader();
    loader.classList.remove('hidden');
    
    reader.onload = (event) => {
        const img = new Image();
        img.onload = async () => {
            try {
                // Guardar imagen original para visualización
                originalImg = img;
                
                // Crear versión redimensionada para procesamiento
                const { img: processed, wasResized } = await resizeImageIfNeeded(img);
                processedImg = processed;
                
                showImageInfo(processedImg, wasResized);
                requestProcessing();
                applyChromaFilters();
                loader.classList.add('hidden');
            } catch (error) {
                console.error('Error al procesar imagen:', error);
                alert('Error al cargar la imagen. Por favor, intente con otra imagen.');
                loader.classList.add('hidden');
            }
        };
        img.onerror = () => {
            console.error('Error al cargar imagen');
            alert('Error al cargar la imagen. Por favor, verifique que el archivo sea válido.');
            loader.classList.add('hidden');
        };
        img.src = event.target.result;
    };
    
    reader.onerror = () => {
        console.error('Error al leer archivo');
        alert('Error al leer el archivo. Por favor, intente nuevamente.');
        loader.classList.add('hidden');
    };
    
    reader.readAsDataURL(file);
});

[saturation, contrast, hueRotate].forEach(el => el.addEventListener('input', applyChromaFilters));
[fftGamma, fftGain, fftOffset].forEach(el => el.addEventListener('input', updateFftValues));

resetBtn.addEventListener('click', () => {
    saturation.value = 1000;
    contrast.value = 500;
    hueRotate.value = 0;
    applyChromaFilters();
});

resetFftBtn.addEventListener('click', () => {
    fftGamma.value = 1.2;
    fftGain.value = 1;
    fftOffset.value = 0;
    updateFftValues();
});

// ============================================
// Pantalla Completa para FFT
// ============================================

const fullscreenFftBtn = document.getElementById('fullscreenFftBtn');
const fftContainer = document.getElementById('fftContainer');

let fullscreenResizeHandler = null;

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        // Entrar en pantalla completa
        fftContainer.requestFullscreen().then(() => {
            // Ajustar tamaño del canvas en pantalla completa
            const updateFullscreenCanvas = () => {
                if (document.fullscreenElement) {
                    const size = Math.min(window.innerWidth, window.innerHeight) * 0.9;
                    fftCanvas.width = size;
                    fftCanvas.height = size;
                    // Redibujar el FFT si hay una imagen procesada
                    if (processedImg && cvReady) {
                        requestProcessing();
                    }
                }
            };
            updateFullscreenCanvas();
            // Guardar referencia al handler para poder removerlo después
            fullscreenResizeHandler = updateFullscreenCanvas;
            window.addEventListener('resize', fullscreenResizeHandler);
        }).catch(err => {
            console.error('Error al entrar en pantalla completa:', err);
            alert('No se pudo activar el modo pantalla completa. Asegúrate de que el navegador lo permita.');
        });
    } else {
        // Salir de pantalla completa
        document.exitFullscreen().then(() => {
            // Remover el listener de resize
            if (fullscreenResizeHandler) {
                window.removeEventListener('resize', fullscreenResizeHandler);
                fullscreenResizeHandler = null;
            }
        }).catch(err => {
            console.error('Error al salir de pantalla completa:', err);
        });
    }
}

// Event listener para el botón
if (fullscreenFftBtn) {
    fullscreenFftBtn.addEventListener('click', toggleFullscreen);
}

// Actualizar el botón cuando cambia el estado de pantalla completa
document.addEventListener('fullscreenchange', () => {
    if (fullscreenFftBtn) {
        if (document.fullscreenElement === fftContainer) {
            fullscreenFftBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
                <span>Salir</span>
            `;
        } else {
            fullscreenFftBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>
                </svg>
                <span>Pantalla completa</span>
            `;
            // Remover el listener de resize si existe
            if (fullscreenResizeHandler) {
                window.removeEventListener('resize', fullscreenResizeHandler);
                fullscreenResizeHandler = null;
            }
            // Restaurar tamaño normal solo si salimos del fullscreen del FFT
            if (!document.fullscreenElement) {
                const container = fftContainer.parentElement;
                const size = container.clientWidth;
                fftCanvas.width = size;
                fftCanvas.height = size;
                if (processedImg && cvReady) {
                    requestProcessing();
                }
            }
        }
    }
});

// ============================================
// Pantalla Completa para Residual Espacial
// ============================================

const fullscreenResidualBtn = document.getElementById('fullscreenResidualBtn');
const residualContainer = document.getElementById('residualContainer');

let fullscreenResidualResizeHandler = null;

function toggleFullscreenResidual() {
    if (!document.fullscreenElement) {
        // Entrar en pantalla completa
        residualContainer.requestFullscreen().then(() => {
            // Ajustar tamaño del canvas en pantalla completa
            const updateFullscreenCanvas = () => {
                if (document.fullscreenElement && document.fullscreenElement === residualContainer) {
                    const maxWidth = window.innerWidth * 0.95;
                    const maxHeight = window.innerHeight * 0.95;
                    const aspectRatio = originalImg ? originalImg.width / originalImg.height : 1;
                    
                    let newWidth, newHeight;
                    // Calcular dimensiones expandiendo hasta llenar el espacio disponible manteniendo aspect ratio
                    if (maxWidth / maxHeight > aspectRatio) {
                        // La altura es el factor limitante - expandir hasta la altura máxima
                        newHeight = maxHeight;
                        newWidth = newHeight * aspectRatio;
                    } else {
                        // El ancho es el factor limitante - expandir hasta el ancho máximo
                        newWidth = maxWidth;
                        newHeight = newWidth / aspectRatio;
                    }
                    
                    // Asegurar que no exceda los límites (aunque ya debería estar dentro)
                    newWidth = Math.min(newWidth, maxWidth);
                    newHeight = Math.min(newHeight, maxHeight);
                    
                    // Asegurar un tamaño mínimo razonable (al menos 200px en la dimensión más pequeña)
                    const minDimension = 200;
                    if (newWidth < minDimension && newHeight < minDimension) {
                        if (aspectRatio > 1) {
                            newWidth = minDimension;
                            newHeight = newWidth / aspectRatio;
                        } else {
                            newHeight = minDimension;
                            newWidth = newHeight * aspectRatio;
                        }
                    }
                    
                    residualCanvas.width = Math.round(newWidth);
                    residualCanvas.height = Math.round(newHeight);
                    // Forzar reflow y redibujar el residual si hay una imagen procesada
                    requestAnimationFrame(() => {
                        if (processedImg && cvReady) {
                            requestProcessing();
                        }
                    });
                }
            };
            updateFullscreenCanvas();
            // Guardar referencia al handler para poder removerlo después
            fullscreenResidualResizeHandler = updateFullscreenCanvas;
            window.addEventListener('resize', fullscreenResidualResizeHandler);
        }).catch(err => {
            console.error('Error al entrar en pantalla completa:', err);
            alert('No se pudo activar el modo pantalla completa. Asegúrate de que el navegador lo permita.');
        });
    } else {
        // Salir de pantalla completa
        document.exitFullscreen().then(() => {
            // Remover el listener de resize
            if (fullscreenResidualResizeHandler) {
                window.removeEventListener('resize', fullscreenResidualResizeHandler);
                fullscreenResidualResizeHandler = null;
            }
        }).catch(err => {
            console.error('Error al salir de pantalla completa:', err);
        });
    }
}

// Event listener para el botón
if (fullscreenResidualBtn) {
    fullscreenResidualBtn.addEventListener('click', toggleFullscreenResidual);
}

// Actualizar el botón cuando cambia el estado de pantalla completa
document.addEventListener('fullscreenchange', () => {
    if (fullscreenResidualBtn) {
        if (document.fullscreenElement === residualContainer) {
            fullscreenResidualBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
                <span>Salir</span>
            `;
        } else {
            fullscreenResidualBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>
                </svg>
                <span>Pantalla completa</span>
            `;
            // Remover el listener de resize si existe
            if (fullscreenResidualResizeHandler) {
                window.removeEventListener('resize', fullscreenResidualResizeHandler);
                fullscreenResidualResizeHandler = null;
            }
            // Restaurar tamaño normal solo si salimos del fullscreen del residual
            if (!document.fullscreenElement) {
                const container = residualContainer.parentElement;
                residualCanvas.width = container.clientWidth;
                residualCanvas.height = (container.clientWidth / (originalImg ? originalImg.width : 1)) * (originalImg ? originalImg.height : 1);
                if (processedImg && cvReady) {
                    requestProcessing();
                }
            }
        }
    }
});

// ============================================
// Pantalla Completa para Mapa de Crominancia
// ============================================

const fullscreenChromaBtn = document.getElementById('fullscreenChromaBtn');
const chromaContainer = document.getElementById('chromaContainer');

let fullscreenChromaResizeHandler = null;

function toggleFullscreenChroma() {
    if (!document.fullscreenElement) {
        // Entrar en pantalla completa
        chromaContainer.requestFullscreen().then(() => {
            // Ajustar tamaño del canvas en pantalla completa
            const updateFullscreenCanvas = () => {
                if (document.fullscreenElement && document.fullscreenElement === chromaContainer) {
                    const maxWidth = window.innerWidth * 0.95;
                    const maxHeight = window.innerHeight * 0.95;
                    const aspectRatio = originalImg ? originalImg.width / originalImg.height : 1;
                    
                    let newWidth, newHeight;
                    // Calcular dimensiones expandiendo hasta llenar el espacio disponible manteniendo aspect ratio
                    if (maxWidth / maxHeight > aspectRatio) {
                        // La altura es el factor limitante - expandir hasta la altura máxima
                        newHeight = maxHeight;
                        newWidth = newHeight * aspectRatio;
                    } else {
                        // El ancho es el factor limitante - expandir hasta el ancho máximo
                        newWidth = maxWidth;
                        newHeight = newWidth / aspectRatio;
                    }
                    
                    // Asegurar que no exceda los límites (aunque ya debería estar dentro)
                    newWidth = Math.min(newWidth, maxWidth);
                    newHeight = Math.min(newHeight, maxHeight);
                    
                    // Asegurar un tamaño mínimo razonable (al menos 200px en la dimensión más pequeña)
                    const minDimension = 200;
                    if (newWidth < minDimension && newHeight < minDimension) {
                        if (aspectRatio > 1) {
                            newWidth = minDimension;
                            newHeight = newWidth / aspectRatio;
                        } else {
                            newHeight = minDimension;
                            newWidth = newHeight * aspectRatio;
                        }
                    }
                    
                    chromaCanvas.width = Math.round(newWidth);
                    chromaCanvas.height = Math.round(newHeight);
                    // Forzar reflow y redibujar el chroma si hay una imagen procesada
                    requestAnimationFrame(() => {
                        if (originalImg) {
                            applyChromaFilters();
                        }
                    });
                }
            };
            updateFullscreenCanvas();
            // Guardar referencia al handler para poder removerlo después
            fullscreenChromaResizeHandler = updateFullscreenCanvas;
            window.addEventListener('resize', fullscreenChromaResizeHandler);
        }).catch(err => {
            console.error('Error al entrar en pantalla completa:', err);
            alert('No se pudo activar el modo pantalla completa. Asegúrate de que el navegador lo permita.');
        });
    } else {
        // Salir de pantalla completa
        document.exitFullscreen().then(() => {
            // Remover el listener de resize
            if (fullscreenChromaResizeHandler) {
                window.removeEventListener('resize', fullscreenChromaResizeHandler);
                fullscreenChromaResizeHandler = null;
            }
        }).catch(err => {
            console.error('Error al salir de pantalla completa:', err);
        });
    }
}

// Event listener para el botón
if (fullscreenChromaBtn) {
    fullscreenChromaBtn.addEventListener('click', toggleFullscreenChroma);
}

// Actualizar el botón cuando cambia el estado de pantalla completa
document.addEventListener('fullscreenchange', () => {
    if (fullscreenChromaBtn) {
        if (document.fullscreenElement === chromaContainer) {
            fullscreenChromaBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
                <span>Salir</span>
            `;
        } else {
            fullscreenChromaBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>
                </svg>
                <span>Pantalla completa</span>
            `;
            // Remover el listener de resize si existe
            if (fullscreenChromaResizeHandler) {
                window.removeEventListener('resize', fullscreenChromaResizeHandler);
                fullscreenChromaResizeHandler = null;
            }
            // Restaurar tamaño normal solo si salimos del fullscreen del chroma
            if (!document.fullscreenElement) {
                const containerWidth = chromaContainer.parentElement.clientWidth;
                const scale = containerWidth / (originalImg ? originalImg.width : 1);
                chromaCanvas.width = (originalImg ? originalImg.width : 1) * scale;
                chromaCanvas.height = (originalImg ? originalImg.height : 1) * scale;
                if (originalImg) {
                    applyChromaFilters();
                }
            }
        }
    }
});

window.addEventListener('resize', () => {
    if (originalImg) {
        // Debounce del resize para evitar procesamiento excesivo
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            applyChromaFilters();
            // No reprocesar FFT en resize, solo actualizar visualización
        }, 300);
    }
});

// Limpiar recursos al cerrar/recargar la página
window.addEventListener('beforeunload', () => {
    if (originalImg) {
        originalImg = null;
    }
    if (processedImg) {
        processedImg = null;
    }
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
});

// ============================================
// Cargar Ejemplos
// ============================================

/**
 * Función para cargar un ejemplo desde la carpeta examples
 * Usa la imagen del thumbnail si está disponible para evitar problemas de CORS
 */
function loadExample(imagePath) {
    loader.classList.remove('hidden');
    
    // Buscar el thumbnail correspondiente
    const thumbnail = document.querySelector(`.example-thumbnail[data-example="${imagePath}"]`);
    const thumbnailImg = thumbnail ? thumbnail.querySelector('img.example-img') : null;
    
    // Función para procesar la imagen una vez cargada
    const processImage = async (img) => {
        try {
            originalImg = img;
            const { img: processed, wasResized } = await resizeImageIfNeeded(img);
            processedImg = processed;
            showImageInfo(processedImg, wasResized);
            requestProcessing();
            applyChromaFilters();
            loader.classList.add('hidden');
        } catch (error) {
            console.error('Error al procesar imagen de ejemplo:', error);
            alert('Error al procesar el ejemplo. Por favor, intente con otro.');
            loader.classList.add('hidden');
        }
    };
    
    // Si el thumbnail existe y tiene una imagen cargada, usarla directamente desde canvas
    if (thumbnailImg) {
        // Si la imagen ya está cargada, extraerla usando canvas para evitar CORS
        if (thumbnailImg.complete && thumbnailImg.naturalWidth > 0) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = thumbnailImg.naturalWidth;
                canvas.height = thumbnailImg.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(thumbnailImg, 0, 0);
                
                const img = new Image();
                img.onload = () => processImage(img);
                img.onerror = () => {
                    console.error('Error al crear imagen desde canvas');
                    tryDirectLoad(imagePath);
                };
                img.src = canvas.toDataURL('image/png');
                return;
            } catch (error) {
                console.error('Error al extraer imagen del thumbnail:', error);
                tryDirectLoad(imagePath);
                return;
            }
        }
        
        // Si la imagen del thumbnail aún se está cargando, esperar
        if (thumbnailImg.src) {
            const checkLoad = () => {
                if (thumbnailImg.complete && thumbnailImg.naturalWidth > 0) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = thumbnailImg.naturalWidth;
                        canvas.height = thumbnailImg.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(thumbnailImg, 0, 0);
                        
                        const img = new Image();
                        img.onload = () => processImage(img);
                        img.onerror = () => tryDirectLoad(imagePath);
                        img.src = canvas.toDataURL('image/png');
                    } catch (error) {
                        tryDirectLoad(imagePath);
                    }
                } else {
                    setTimeout(checkLoad, 100);
                }
            };
            checkLoad();
            return;
        }
    }
    
    // Si no hay thumbnail disponible, intentar cargar directamente
    tryDirectLoad(imagePath);
    
    function tryDirectLoad(path) {
        const img = new Image();
        
        img.onload = () => processImage(img);
        
        img.onerror = () => {
            console.error('Error al cargar imagen de ejemplo:', path);
            loader.classList.add('hidden');
            
            // Mostrar advertencia en la UI
            const corsWarning = document.getElementById('corsWarning');
            if (corsWarning) {
                corsWarning.classList.remove('hidden');
            }
            
            alert('Error de CORS: No se puede cargar el archivo desde file://\n\nPor favor, ejecute un servidor local:\n\n1. Abra la terminal en esta carpeta\n2. Ejecute: python3 -m http.server 8000\n3. Abra: http://localhost:8000/forensic_tool.html');
        };
        
        img.src = path;
    }
}

// ============================================
// Generar Ejemplos Dinámicamente
// ============================================

/**
 * Genera los thumbnails de ejemplos dinámicamente desde examplesList
 */
function generateExamples() {
    const container = document.getElementById('examplesContainer');
    if (!container) {
        console.warn('Contenedor de ejemplos no existe');
        return;
    }
    
    if (typeof examplesList === 'undefined') {
        console.error('examplesList no está disponible');
        container.innerHTML = '<p class="text-xs text-gray-500">Error: No se pudo cargar la lista de ejemplos</p>';
        return;
    }
    
    console.log('Generando ejemplos desde:', examplesList);
    container.innerHTML = ''; // Limpiar contenedor
    
    // Función para crear un thumbnail
    const createThumbnail = (filename, type) => {
        const imagePath = `examples/${filename}`;
        const label = filename.replace(/\.(png|jpg|jpeg|gif|webp|PNG|JPG|JPEG|GIF|WEBP)$/i, '').replace(/^[^_]+_/, '');
        const badgeClass = type === 'real' ? 'example-badge-real' : 'example-badge-ai';
        const badgeText = type === 'real' ? 'Real' : 'AI';
        
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'example-thumbnail';
        button.setAttribute('data-example', imagePath);
        button.setAttribute('data-type', type);
        
        button.innerHTML = `
            <div class="relative">
                <img src="${imagePath}" alt="${label}" class="example-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="example-placeholder" style="display: none;">
                    <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                </div>
                <div class="example-badge ${badgeClass}">${badgeText}</div>
            </div>
            <p class="example-label">${label}</p>
        `;
        
        return button;
    };
    
    // Agregar ejemplos reales primero
    if (examplesList.real && examplesList.real.length > 0) {
        examplesList.real.forEach(filename => {
            container.appendChild(createThumbnail(filename, 'real'));
        });
    }
    
    // Agregar ejemplos AI
    if (examplesList.ai && examplesList.ai.length > 0) {
        examplesList.ai.forEach(filename => {
            container.appendChild(createThumbnail(filename, 'ai'));
        });
    }
    
    console.log(`✅ Generados ${(examplesList.real?.length || 0) + (examplesList.ai?.length || 0)} thumbnails`);
}

// Generar ejemplos cuando el DOM esté listo y examplesList esté disponible
function initExamples() {
    if (typeof examplesList !== 'undefined') {
        console.log('examplesList cargado:', examplesList);
        generateExamples();
    } else {
        // Si examplesList aún no está disponible, esperar un poco más
        console.warn('examplesList no disponible, reintentando...');
        setTimeout(initExamples, 100);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExamples);
} else {
    initExamples();
}

// Añadir event listeners a los botones de ejemplo usando event delegation
document.addEventListener('click', (e) => {
    const thumbnail = e.target.closest('.example-thumbnail');
    if (thumbnail) {
        e.preventDefault();
        e.stopPropagation();
        const imagePath = thumbnail.getAttribute('data-example');
        console.log('Example clicked:', imagePath);
        if (imagePath) {
            loadExample(imagePath);
        }
    }
});

