param([string]$Task = 'otm_install', [string]$Log = 'C:\dev\logs\install.log', [string]$Pattern = 'Successfully installed|Found |Failed|rror|Installing|Downloading')
(Get-ScheduledTask -TaskName $Task).State
if (Test-Path $Log) { Get-Content $Log | Select-String -Pattern $Pattern | Select-Object -Last 14 | ForEach-Object { $_.Line.Trim() } }
