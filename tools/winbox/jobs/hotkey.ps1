# Presses a tracer hotkey (F8 re-arm, F9 marker, F10 summary) so that the coverage tracer's polling sees it.
param([ValidateSet('F8', 'F9', 'F10', 'F11')][string]$Key = 'F9')
. "$PSScriptRoot\lib_input.ps1"
$vk = @{ F8 = 0x77; F9 = 0x78; F10 = 0x79; F11 = 0x7A }[$Key]
Write-Output "focus: $(Focus-Game)"
Hold-Key $vk 250
Write-Output "pressed $Key"
