// Copyable local-development command. The token is entered at a masked prompt,
// never embedded in a command, source file, or shell history.
export const RUNNER_START_POWERSHELL = `$runnerSecret = Read-Host "Runner token" -AsSecureString
$env:ODDPATH_RUNNER_TOKEN = [System.Net.NetworkCredential]::new('', $runnerSecret).Password
Remove-Variable runnerSecret
npm run dev:runner`;
