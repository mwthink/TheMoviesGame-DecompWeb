# Installs the OpenAL runtime (Creative's official oalinst.exe from openal.org) so MoviesSE.exe can load OpenAL32.dll.
# winget's own package fails here (its download host does not resolve), so download the installer directly, check its signature
# and run it silently.
$ErrorActionPreference = 'Stop'
$dir = 'C:\dev\downloads\openal'; New-Item -ItemType Directory -Force $dir | Out-Null
$zip = "$dir\oalinst.zip"
$ok = $false
foreach ($u in 'https://openal.org/downloads/oalinst.zip', 'https://www.openal.org/downloads/oalinst.zip') {
    try { Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 60; $ok = $true; Write-Output "downloaded $u ($((Get-Item $zip).Length) bytes)"; break } catch { Write-Output "failed $u : $($_.Exception.Message)" }
}
if (-not $ok) { throw 'download failed' }
Expand-Archive -Path $zip -DestinationPath $dir -Force
$exe = Get-ChildItem $dir -Recurse -Filter oalinst.exe | Select-Object -First 1
$sig = Get-AuthenticodeSignature $exe.FullName
Write-Output ("oalinst.exe signature: {0}, signer: {1}" -f $sig.Status, $sig.SignerCertificate.Subject)
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Creative') { throw 'signature is not a valid Creative signature: not running it' }
$p = Start-Process -FilePath $exe.FullName -ArgumentList '/s' -Wait -PassThru
Write-Output "installer exit code: $($p.ExitCode)"
Get-ChildItem C:\Windows\SysWOW64\OpenAL32.dll, C:\Windows\System32\OpenAL32.dll -ErrorAction SilentlyContinue | Select-Object FullName, Length
