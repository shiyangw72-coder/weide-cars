# Start car-dealer server in background
$workingDir = "C:\Users\Administrator\.qclaw\workspace\car-dealer"
$logFile = Join-Path $workingDir "server.log"

# Kill existing processes
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "app\.js" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Start server (no output redirection - just run in background)
Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "app.js" -WorkingDirectory $workingDir

Start-Sleep -Seconds 3

# Check if running
$proc = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "app\.js" }
if ($proc) {
    Write-Output "✅ Server started: PID $($proc.Id)"
    # Test with curl
    $result = curl.exe -s -o NUL -w "%{http_code}" "http://127.0.0.1:3000/" 2>&1
    Write-Output "HTTP Status: $result"
} else {
    Write-Output "❌ Server failed to start"
}
