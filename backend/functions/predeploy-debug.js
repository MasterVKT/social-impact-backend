/**
 * Script de debug pour le predeploy Firebase
 * Logs les informations critiques pour diagnostiquer les problèmes de déploiement
 */

// #region agent log
fetch('http://127.0.0.1:7243/ingest/6a80703d-ab9d-4e44-b2eb-591fd9b386b4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'predeploy-debug.js:10',message:'Predeploy script started',data:{processEnv:process.env,platform:process.platform,nodeVersion:process.version,cwd:process.cwd()},timestamp:Date.now(),sessionId:'debug-session',runId:'predeploy-1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// #region agent log
fetch('http://127.0.0.1:7243/ingest/6a80703d-ab9d-4e44-b2eb-591fd9b386b4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'predeploy-debug.js:15',message:'About to check RESOURCE_DIR',data:{resourceDir:process.env.RESOURCE_DIR,allEnvKeys:Object.keys(process.env).filter(k=>k.includes('RESOURCE')||k.includes('FIREBASE'))},timestamp:Date.now(),sessionId:'debug-session',runId:'predeploy-1',hypothesisId:'B'})}).catch(()=>{});
// #endregion

const resourceDir = process.env.RESOURCE_DIR || process.cwd();

// #region agent log
fetch('http://127.0.0.1:7243/ingest/6a80703d-ab9d-4e44-b2eb-591fd9b386b4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'predeploy-debug.js:20',message:'Resource directory determined',data:{resourceDir,exists:fs.existsSync(resourceDir),packageJsonExists:fs.existsSync(path.join(resourceDir,'package.json'))},timestamp:Date.now(),sessionId:'debug-session',runId:'predeploy-1',hypothesisId:'C'})}).catch(()=>{});
// #endregion

try {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/6a80703d-ab9d-4e44-b2eb-591fd9b386b4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'predeploy-debug.js:25',message:'About to run npm build',data:{command:`npm --prefix "${resourceDir}" run build`},timestamp:Date.now(),sessionId:'debug-session',runId:'predeploy-1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion

  const buildOutput = execSync(`npm --prefix "${resourceDir}" run build`, {
    encoding: 'utf-8',
    cwd: resourceDir,
    stdio: 'inherit'
  });

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/6a80703d-ab9d-4e44-b2eb-591fd9b386b4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'predeploy-debug.js:33',message:'Build completed successfully',data:{outputLength:buildOutput?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'predeploy-1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

  console.log('✅ Predeploy build completed successfully');
} catch (error) {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/6a80703d-ab9d-4e44-b2eb-591fd9b386b4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'predeploy-debug.js:38',message:'Build failed',data:{errorMessage:error.message,errorCode:error.code,errorStatus:error.status,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'predeploy-1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion

  console.error('❌ Predeploy build failed:', error.message);
  process.exit(1);
}

