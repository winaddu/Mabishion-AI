import { BaseWorker } from './baseWorker.js';
import { getDb } from '../../data/db.js';
import { executeLlmWithFallback } from '../../services/llmManager.js';
import { CodeValidator } from '../validators/codeValidator.js';
import { ClientProfile } from '../memory/clientProfile.js';
import { ComplexityAnalyzer } from '../orchestrator/complexityAnalyzer.js';

export class DeveloperWorker extends BaseWorker {
  constructor() {
    super('Developer', 'development', true, 'critical');
  }

  /**
   * Generates source code for a specific module using LLM
   * @param {string} projectId  SQLite project ID
   * @param {object} params     { module_name, tech_stack, requirements_override }
   */
  async execute(projectId, params = {}) {
    const db = await getDb();

    // ── 1. Fetch project ──────────────────────────────────────────────────────
    const projRows = await db.select('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!projRows || projRows.length === 0) {
      throw new Error(`Project "${projectId}" not found in SQLite projects table.`);
    }
    const project = projRows[0];

    const projectName = project.name        || 'AI Project';
    const clientName  = project.client_name || 'Client';
    const projectType = project.type        || 'Web Application';
    const moduleName  = params.module_name  || 'Dashboard Component';
    // FR-038: Support Python scripts in addition to React/JS (PRD P0-F6)
    const isPython = params.tech_stack && params.tech_stack.toLowerCase().includes('python');
    const techStack = params.tech_stack || (isPython ? 'Python 3.11, standard library' : 'React 18, Tailwind CSS, Vite, SQLite');

    // ── Kimi Client Context Enrichment ───────────────────────────────────────
    const clientProfileHelper = new ClientProfile(db);
    let clientEnrichmentPrompt = '';
    try {
      const clientRecord = await clientProfileHelper.getByName(clientName);
      if (clientRecord && clientRecord.length > 0) {
        const client = clientRecord[0];
        clientEnrichmentPrompt = `Client Budget: $${client.budget || 0} | Business Sector: ${client.business || 'Standard'} | Past Preferences: ${JSON.stringify(client.preferences || {})}`;
      }
    } catch (err) {
      console.warn('[DeveloperWorker] Failed to query client profile for prompt enrichment:', err);
    }

    // ── Kimi Complexity Analysis ─────────────────────────────────────────────
    const complexityAnalyzerHelper = new ComplexityAnalyzer();
    const requirements = params.requirements_override || project.notes || `Build a ${moduleName} for ${projectName}`;
    const complexityResult = complexityAnalyzerHelper.analyze({
      description: requirements,
      productType: projectType,
      domain: project.domain || 'Digital Services'
    });

    const complexityHint = complexityResult.score > 7 
      ? `🚨 HIGH COMPLEXITY WARNING (Score: ${complexityResult.score}/10): This module has critical design, security, and algorithmic complexity. Ensure comprehensive code architecture, highly optimized operations, and maximum safety checks.`
      : `Standard complexity module execution (Score: ${complexityResult.score}/10).`;

    // ── 2. Fetch blueprint context ────────────────────────────────────────────
    let prdContext = '';
    let techStackFromBlueprint = techStack;
    try {
      const bpRows = await db.select(
        'SELECT prd_text, tech_stack_json FROM blueprints WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
        [projectId]
      );
      if (bpRows && bpRows.length > 0) {
        prdContext = (bpRows[0].prd_text || '').slice(0, 500);
        const ts = JSON.parse(bpRows[0].tech_stack_json || '{}');
        if (ts.frontend && ts.frontend.length > 0) {
          techStackFromBlueprint = [...(ts.frontend || []), ...(ts.backend || [])].join(', ');
        }
      }
    } catch { /* non-fatal */ }

    const finalStack = params.tech_stack || techStackFromBlueprint;

    // ── 3. LLM CALL 1 — Source Code ──────────────────────────────────────────
    const codeSystemPrompt = `You are Mickii Senior Developer — an expert full-stack engineer specializing in React, Node.js, and AI integrations.
Generate production-ready source code for the requested module.

COMPLEXITY HINT:
${complexityHint}

Return a valid JSON object with these keys ONLY:
{
  "mainComponent": { "filename": "ComponentName.jsx", "code": "full source code here" },
  "styleFile": { "filename": "component.module.css", "code": "CSS styles here" },
  "utilFile": { "filename": "utils.js", "code": "utility functions here" },
  "folderStructure": ["src/", "src/components/", "src/components/ComponentName.jsx"],
  "dependencies": { "react": "^18.2.0" },
  "moduleReadme": "Brief markdown README for this module"
}
Rules:
- Write complete, runnable code (not pseudocode)
- Add JSDoc comments to all functions
- Include proper error handling (try/catch)
- Mobile-responsive if UI component
- Follow Glassmorphism dark design (bg-slate-900, border-white/10, indigo accents)
- No markdown code blocks inside JSON strings (use escaped newlines)
- Output ONLY valid JSON`;

    const codeUserPrompt = `
Module: ${moduleName}
Project: ${projectName} (${projectType})
Client: ${clientName}
${clientEnrichmentPrompt ? 'Client Context: ' + clientEnrichmentPrompt : ''}
Tech Stack: ${finalStack}
Requirements: ${requirements}
${prdContext ? 'PRD Context: ' + prdContext : ''}

Generate complete production code for this module.`;

    let codeData = null;
    let codeIssues = [];
    let strikes = 0;
    const maxStrikes = 3;
    let currentCodeSystemPrompt = codeSystemPrompt;

    while (strikes < maxStrikes) {
      let rawText = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          rawText = await executeLlmWithFallback(codeUserPrompt, currentCodeSystemPrompt);
          break;
        } catch (err) {
          console.warn(`[DeveloperWorker] Code LLM attempt ${attempt}/3 failed:`, err.message);
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }

      if (!rawText) {
        throw new Error("Source generation failed: no provider returned code. Check provider settings and retry.");
      }

      try {
        let clean = rawText.trim();
        if (clean.startsWith('```')) clean = clean.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        codeData = JSON.parse(clean);

        // Perform strict code validation
        codeIssues = [];
        const codeText = codeData?.mainComponent?.code || '';
        const filename = codeData?.mainComponent?.filename || '';
        if (typeof codeText !== 'string' || !codeText.trim() || typeof filename !== 'string' || !filename.trim()) {
          throw new Error('Source code and filename are required.');
        }

        // 1. Hardcoded brand leak check
        if (/mabishion/i.test(codeText) || /nexious/i.test(codeText)) {
          codeIssues.push('Hardcoded brand reference ("Mabishion" or "Nexious") found in the generated source code.');
        }

        // 2. Generic component name check
        const genericNames = ['generic', 'placeholder', 'testcomponent', 'dummycomponent', 'componentname'];
        const lowerFilename = filename.toLowerCase();
        const isGenericFilename = genericNames.some(name => lowerFilename.includes(name)) || lowerFilename === 'component.jsx';

        if (isGenericFilename) {
          codeIssues.push(`Generic component name or filename found: "${filename}". Please use client-specific, descriptive component names.`);
        }

        // 3. Kimi CodeValidator Integration
        const codeValidatorHelper = new CodeValidator();
        const codeValidationResult = codeValidatorHelper.validate(codeText);
        if (!codeValidationResult.valid) {
          codeValidationResult.findings.forEach(f => {
            const fName = f.name || f.id || 'Security Finding';
            const fRec = f.recommendation || `Matches pattern: ${f.matches ? f.matches.join(', ') : 'unknown'}`;
            const fLine = f.line ? ` (Line ${f.line})` : '';
            codeIssues.push(`${fName} (Severity: ${f.severity}): ${fRec}${fLine}`);
          });
          if (codeValidationResult.syntaxErrors) {
            codeValidationResult.syntaxErrors.forEach(s => {
              codeIssues.push(`Syntax Check: ${s.name || s.id || 'Syntax anomaly detected'}`);
            });
          }
        }

        if (codeIssues.length === 0) {
          break; // Passed validation!
        }
      } catch (err) {
        codeIssues = [`Invalid JSON returned: ${err.message}`];
      }

      strikes++;
      console.warn(`[Developer Worker] Strike ${strikes}/${maxStrikes} - Code validation failed:`, codeIssues);

      // Feed validation error feedback back to prompt for the next strike
      currentCodeSystemPrompt = `${codeSystemPrompt}

🚨 IMPORTANT REVISION FEEDBACK (STRIKE ${strikes}/${maxStrikes}):
Your previous generated code/JSON failed strict content validation with the following issues:
${codeIssues.map(issue => `- ${issue}`).join('\n')}

Please regenerate the valid JSON. Ensure:
1. Under no circumstances should the component code, comments, or UI texts contain the developer brand name "Mabishion" or "Nexious".
2. Use descriptive, client-specific component names instead of generic names like "GenericComponent" or "ComponentName".
3. Return ONLY valid JSON format.`;
    }

    if (codeIssues.length > 0 && strikes >= maxStrikes) {
      console.error('[Developer Worker] Strict Code Validation Failed after 3 strikes!', codeIssues);
      throw new Error(`Strict Code Validation Failed after 3 strikes: ${codeIssues.join('; ')}`);
    }

    // ── 4. LLM CALL 2 — Unit Tests ───────────────────────────────────────────
    let testCode = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const testPrompt = `You are a senior QA engineer. Write comprehensive unit tests for the ${moduleName} module using Jest + React Testing Library.
Include: render tests, user interaction tests, edge case tests, mock API tests.
Return ONLY the test file code as plain text (no JSON wrapper, no markdown fences).`;
        const testUser = `Module: ${moduleName}\nTech Stack: ${finalStack}\nComponent code context: ${JSON.stringify(codeData?.mainComponent?.code || '').slice(0, 400)}`;
        testCode = await executeLlmWithFallback(testUser, testPrompt);
        break;
      } catch {
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }

    testCode = testCode || `// Tests pending — manual review required\n`;

    // ── 6. Ensure code_modules table ─────────────────────────────────────────
    await db.execute(`
      CREATE TABLE IF NOT EXISTS code_modules (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        module_name TEXT,
        main_filename TEXT,
        code_text TEXT,
        style_code TEXT,
        util_code TEXT,
        test_text TEXT,
        folder_structure TEXT,
        dependencies_json TEXT,
        module_readme TEXT,
        tech_stack TEXT,
        version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {});

    const moduleId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO code_modules (id, project_id, module_name, main_filename, code_text, style_code, util_code, test_text, folder_structure, dependencies_json, module_readme, tech_stack, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)`,
      [
        moduleId, projectId, moduleName,
        codeData.mainComponent?.filename || `${moduleName}.jsx`,
        codeData.mainComponent?.code     || '',
        codeData.styleFile?.code         || '',
        codeData.utilFile?.code          || '',
        testCode,
        JSON.stringify(codeData.folderStructure || []),
        JSON.stringify(codeData.dependencies    || {}),
        codeData.moduleReadme            || '',
        finalStack,
        1
      ]
    );

    // Update project stage to Development
    await db.execute("UPDATE projects SET stage = 'Development' WHERE id = $1", [projectId]).catch(() => {});

    // Approval record is created by the runWorker gate (single enforcement point, P0-2).

    return {
      moduleId,
      projectName,
      moduleName,
      techStack:       finalStack,
      mainFilename:    codeData.mainComponent?.filename,
      styleFilename:   codeData.styleFile?.filename,
      utilFilename:    codeData.utilFile?.filename,
      codeLineCount:   (codeData.mainComponent?.code || '').split('\n').length,
      testLineCount:   (testCode || '').split('\n').length,
      folderStructure: codeData.folderStructure,
      dependencies:    codeData.dependencies,
      moduleReadme:    codeData.moduleReadme,
      summary: `Module "${moduleName}" generated for ${projectName} | ${(codeData.mainComponent?.code || '').split('\n').length} lines of code | ${(testCode || '').split('\n').length} test lines`
    };
  }
}
