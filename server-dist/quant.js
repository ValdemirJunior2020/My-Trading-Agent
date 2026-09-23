import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const pythonPath = join(process.cwd(), '.venv-quant', 'Scripts', 'python.exe');
const bridgePath = join(process.cwd(), 'quant', 'bridge.py');
const rdScriptWindows = join(process.cwd(), 'quant', 'run-rdagent-wsl.sh');
const parseBridge = (stdout) => {
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
    const parsed = JSON.parse(line);
    if (!parsed.ok)
        throw new Error(parsed.error || 'Quant engine failed.');
    return parsed.result;
};
export const nativeQuantStatus = async () => {
    if (!existsSync(pythonPath) || !existsSync(bridgePath)) {
        return {
            available: false,
            vectorbt: { installed: false },
            nautilusTrader: { installed: false },
            python: null
        };
    }
    try {
        const { stdout } = await execFileAsync(pythonPath, [bridgePath, 'status'], { timeout: 15000, windowsHide: true });
        return { available: true, ...parseBridge(stdout) };
    }
    catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
};
export const rdAgentStatus = async () => {
    try {
        const { stdout } = await execFileAsync('wsl.exe', ['-e', 'bash', '-lc', 'test -x "$HOME/.my-trading-agent-rdagent/.venv/bin/rdagent" && "$HOME/.my-trading-agent-rdagent/.venv/bin/rdagent" --help >/dev/null && echo RDAGENT_OK'], { timeout: 15000, windowsHide: true });
        if (!stdout.includes('RDAGENT_OK'))
            throw new Error('RD-Agent executable was not confirmed inside WSL.');
        return { installed: true, transport: 'wsl' };
    }
    catch (error) {
        return { installed: false, transport: 'wsl', error: error instanceof Error ? error.message : String(error) };
    }
};
export const quantStatus = async () => {
    const [native, rdAgent] = await Promise.all([nativeQuantStatus(), rdAgentStatus()]);
    return { ...native, rdAgent };
};
const runVectorbtCommand = async (command, payload) => {
    if (!existsSync(pythonPath))
        throw new Error('Quant environment is not installed. Run INSTALL-QUANT-ENGINES.bat.');
    const child = spawn(pythonPath, [bridgePath, command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    const errors = [];
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => errors.push(String(chunk)));
    child.stdin.end(JSON.stringify(payload));
    const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error('VectorBT timed out.')); }, 120000);
        child.on('error', err => { clearTimeout(timer); reject(err); });
        child.on('close', value => { clearTimeout(timer); resolve(value ?? 1); });
    });
    if (code !== 0)
        throw new Error(errors.join('').trim() || output.join('').trim() || 'VectorBT failed.');
    return parseBridge(output.join(''));
};
export const runVectorbtSma = (payload) => runVectorbtCommand('vectorbt-sma', payload);
export const runVectorbtValidation = (payload) => runVectorbtCommand('vectorbt-validate', payload);
export const runNautilusSmoke = async () => {
    if (!existsSync(pythonPath))
        throw new Error('Quant environment is not installed. Run INSTALL-QUANT-ENGINES.bat.');
    const { stdout, stderr } = await execFileAsync(pythonPath, [bridgePath, 'nautilus-smoke'], { timeout: 30000, windowsHide: true });
    if (stderr?.trim())
        console.warn('[nautilus]', stderr.trim());
    return parseBridge(stdout);
};
export const runRdAgent = async (command, stepN = 1, loopN = 1) => {
    const safeCommand = command.replace(/[^a-z_]/g, '');
    const extra = (command === 'fin_quant' || command === 'fin_factor') ? ' ' + Math.max(1, Math.floor(stepN)) + ' ' + Math.max(1, Math.floor(loopN)) : '';
    const bin = '$HOME/.my-trading-agent-rdagent/.venv/bin/rdagent';
    const commandMap = {
        health: 'health_check --no-check-docker --no-check-ports',
        info: 'collect_info',
        fin_quant: 'fin_quant --step-n ' + Math.max(1, Math.floor(stepN)) + ' --loop-n ' + Math.max(1, Math.floor(loopN)) + ' --no-checkout',
        fin_factor: 'fin_factor --step-n ' + Math.max(1, Math.floor(stepN)) + ' --loop-n ' + Math.max(1, Math.floor(loopN)) + ' --no-checkout'
    };
    const shell = 'test -x "' + bin + '" || { echo "RD-Agent is not installed in WSL." >&2; exit 1; }; "' + bin + '" ' + commandMap[safeCommand];
    const { stdout, stderr } = await execFileAsync('wsl.exe', ['-e', 'bash', '-lc', shell], { timeout: command === 'health' || command === 'info' ? 120000 : 3600000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return { command, stdout: stdout.trim(), stderr: stderr.trim() };
};
