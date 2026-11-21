<#
 One-time setup for the Windows test box (see docs/WINDOWS_TEST_BOX.md). RUN THIS YOURSELF, in an elevated PowerShell, once.
 It makes system and security changes (SSH server, firewall, auto-logon, power, Defender exclusions); they are deliberately left to
 you, each behind its own switch, so you can read what it does before saying yes. Not tested on a real machine: read it first.

   powershell -ExecutionPolicy Bypass -File setup_box.ps1 -PublicKeyFile C:\path\to\key.pub -Ssh -Power -Exclusions -Autologon -Tools

 -Ssh         install and start OpenSSH Server, open port 22 on the Private profile only, install the public key (key login).
              It does NOT turn password login off: do that yourself in C:\ProgramData\ssh\sshd_config once the key works.
 -Power       never sleep, never turn the display off, no lock screen, no screen saver, no password on wake.
 -Exclusions  Defender exclusions for C:\Games and C:\dev (injecting a DLL into a suspended process looks like malware).
              Tamper Protection must be off first (Windows Security > Virus & threat protection > settings); it cannot be scripted.
 -Autologon   sign this account in automatically at boot (asks for the password; Windows keeps it in the registry in clear text,
              so use this only on a throwaway box). The game needs a logged-in desktop; a reboot over SSH then recovers a wedged session.
 -Tools       install Git, Python, CMake, PowerShell 7, AutoHotkey, Visual Studio Build Tools (C++), and clone and bootstrap vcpkg.
 Nothing here turns on Remote Desktop: RDP is not needed and a disconnected RDP session can break Direct3D.
#>
param(
    [string]$PublicKeyFile,
    [switch]$Ssh, [switch]$Power, [switch]$Exclusions, [switch]$Autologon, [switch]$Tools
)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')) {
    throw 'Run this in an elevated (Administrator) PowerShell.'
}
foreach ($d in 'C:\Games', 'C:\dev') { New-Item -ItemType Directory -Force $d | Out-Null }

if ($Ssh) {
    if (-not $PublicKeyFile -or -not (Test-Path $PublicKeyFile)) { throw '-Ssh needs -PublicKeyFile <path to a .pub file>.' }
    if (-not (Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Where-Object State -eq 'Installed')) {
        Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
    }
    Set-Service sshd -StartupType Automatic
    Start-Service sshd
    # port 22, Private network profile only
    if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP-Private' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP-Private' -DisplayName 'OpenSSH Server (private networks)' -Enabled True `
            -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -Profile Private | Out-Null
    }
    # administrators read keys from here, and sshd ignores it unless only Administrators and SYSTEM can write it
    $auth = 'C:\ProgramData\ssh\administrators_authorized_keys'
    $key = (Get-Content $PublicKeyFile -Raw).Trim()
    if (-not (Test-Path $auth) -or -not ((Get-Content $auth -Raw) -match [regex]::Escape($key))) { Add-Content -Path $auth -Value $key }
    icacls $auth /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
    Write-Host "SSH ready. Network profile of this machine: $((Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory) (the rule only applies to Private)."
}

if ($Power) {
    powercfg /change monitor-timeout-ac 0; powercfg /change monitor-timeout-dc 0
    powercfg /change standby-timeout-ac 0; powercfg /change standby-timeout-dc 0
    powercfg /change hibernate-timeout-ac 0; powercfg /hibernate off
    powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0; powercfg /setactive SCHEME_CURRENT
    New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Force | Out-Null
    Set-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Name NoLockScreen -Value 1 -Type DWord
    Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name ScreenSaveActive -Value '0'
    Write-Host 'Power: no sleep, no display timeout, no lock screen.'
}

if ($Exclusions) {
    Add-MpPreference -ExclusionPath 'C:\Games', 'C:\dev'
    Write-Host 'Defender exclusions added for C:\Games and C:\dev (if this failed, Tamper Protection is on).'
}

if ($Autologon) {
    $user = $env:USERNAME
    $pw = Read-Host "Password for $user (stored in clear text in the registry)" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
    $k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    Set-ItemProperty $k -Name AutoAdminLogon -Value '1'
    Set-ItemProperty $k -Name DefaultUserName -Value $user
    Set-ItemProperty $k -Name DefaultDomainName -Value $env:COMPUTERNAME
    Set-ItemProperty $k -Name DefaultPassword -Value $plain
    Write-Host "Auto-logon set for $user. Reboot to test it."
}

if ($Tools) {
    $pkgs = 'Git.Git', 'Python.Python.3.12', 'Kitware.CMake', 'Microsoft.PowerShell', 'AutoHotkey.AutoHotkey'
    foreach ($p in $pkgs) { winget install --id $p -e --source winget --accept-package-agreements --accept-source-agreements }
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --accept-package-agreements --accept-source-agreements --override `
        '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621'
    if (-not (Test-Path 'C:\dev\vcpkg')) { & 'C:\Program Files\Git\cmd\git.exe' clone https://github.com/microsoft/vcpkg C:\dev\vcpkg }
    & 'C:\dev\vcpkg\bootstrap-vcpkg.bat' -disableMetrics
    [Environment]::SetEnvironmentVariable('VCPKG_ROOT', 'C:\dev\vcpkg', 'Machine')
    Write-Host 'Tools installed. Open a new shell for PATH changes.'
}
Write-Host 'Done. Next: reboot, then from the Mac: ssh <user>@<host> "cmd /c ver && whoami && query user"'
