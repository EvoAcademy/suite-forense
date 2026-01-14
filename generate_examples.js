const fs = require('fs');
const path = require('path');

const examplesDir = path.join(__dirname, 'examples');
const outputFile = path.join(__dirname, 'examples_list.js');

// Leer archivos de la carpeta examples
const files = fs.readdirSync(examplesDir)
    .filter(file => {
        // Filtrar archivos ocultos y solo incluir imágenes
        return !file.startsWith('.') && 
               /\.(png|jpg|jpeg|gif|webp|PNG|JPG|JPEG|GIF|WEBP)$/i.test(file);
    })
    .sort();

// Separar en reales y AI según el prefijo del nombre
const realExamples = files.filter(f => f.toLowerCase().startsWith('real_'));
const aiExamples = files.filter(f => f.toLowerCase().startsWith('ai_'));

// Generar el archivo JavaScript
const jsContent = `// Este archivo se genera automáticamente. No editar manualmente.
// Ejecuta: node generate_examples.js para regenerar

const examplesList = {
    real: ${JSON.stringify(realExamples, null, 2)},
    ai: ${JSON.stringify(aiExamples, null, 2)}
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = examplesList;
}
`;

fs.writeFileSync(outputFile, jsContent, 'utf8');
console.log(`✅ Generado examples_list.js con ${realExamples.length} ejemplos reales y ${aiExamples.length} ejemplos AI`);
console.log('Ejemplos reales:', realExamples);
console.log('Ejemplos AI:', aiExamples);
