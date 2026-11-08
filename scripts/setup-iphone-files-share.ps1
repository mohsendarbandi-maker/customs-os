# Customs OS - secure SMB share for the iPhone Files app
# Run in Windows PowerShell as Administrator. The firewall rule is LAN-only.
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'PowerShell را با گزینه Run as administrator اجرا کنید.'
}
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'پوشه Darbandi Commercial را انتخاب کنید؛ همان پوشه‌ای که فایل‌منیجر در آن همگام‌سازی می‌کند.'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host 'لغو شد.' -ForegroundColor Yellow; exit 1 }
$sharePath = $dialog.SelectedPath
if (-not (Test-Path -LiteralPath $sharePath -PathType Container)) { throw 'پوشه انتخاب‌شده وجود ندارد.' }

$shareName = 'DarbandiCommercial'
$userName = 'DarbandiFiles'
$existingUser = Get-LocalUser -Name $userName -ErrorAction SilentlyContinue
$newCredential = $false
if ($existingUser) {
  Write-Host "کاربر محلی $userName از قبل وجود دارد؛ رمز فعلی حفظ می‌شود." -ForegroundColor Yellow
} else {
  $sharePassword = Read-Host 'برای اتصال آیفون یک رمز قوی وارد کنید' -AsSecureString
  if (-not $sharePassword -or $sharePassword.Length -lt 12) { throw 'رمز باید حداقل ۱۲ نویسه داشته باشد.' }
  New-LocalUser -Name $userName -Password $sharePassword -PasswordNeverExpires -UserMayNotChangePassword -Description 'Customs OS iPhone Files SMB access' | Out-Null
  $newCredential = $true
}

$share = Get-SmbShare -Name $shareName -ErrorAction SilentlyContinue
if ($share) {
  if ([IO.Path]::GetFullPath($share.Path).TrimEnd('\') -ne [IO.Path]::GetFullPath($sharePath).TrimEnd('\')) {
    throw "نام Share از قبل برای مسیر دیگری استفاده شده است: $($share.Path). ابتدا آن Share را در Windows بررسی کنید."
  }
  Grant-SmbShareAccess -Name $shareName -AccountName $userName -AccessRight Change -Force | Out-Null
} else {
  New-SmbShare -Name $shareName -Path $sharePath -ChangeAccess $userName -FolderEnumerationMode AccessBased | Out-Null
}
$ntfsRule = $env:COMPUTERNAME + '\' + $userName + ':(OI)(CI)M'
& icacls.exe $sharePath /grant $ntfsRule /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'اعمال مجوز فایل‌سیستم کامل نشد؛ پوشه و مجوزهای آن را بررسی کنید.' }

Set-SmbServerConfiguration -EnableSMB2Protocol $true -EnableSMB1Protocol $false -Force | Out-Null
$ruleName = 'Customs OS iPhone Files SMB (Private LAN only)'
$oldRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($oldRule) { Remove-NetFirewallRule -DisplayName $ruleName }
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 445 -Profile Private -RemoteAddress LocalSubnet | Out-Null

$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
  Select-Object -ExpandProperty IPAddress -Unique
Write-Host ''
Write-Host 'اشتراک‌گذاری امن محلی آماده شد.' -ForegroundColor Green
Write-Host "Share: \\$env:COMPUTERNAME\$shareName"
Write-Host "Username: $env:COMPUTERNAME\$userName"
if ($newCredential) { Write-Host 'رمز را فقط در آیفون وارد کنید؛ این اسکریپت آن را ذخیره نمی‌کند.' -ForegroundColor Yellow }
Write-Host ''
Write-Host 'در iPhone > Files > Browse > … > Connect to Server یکی از آدرس‌های زیر را وارد کنید:'
foreach ($ip in $addresses) { Write-Host "smb://$ip" -ForegroundColor Cyan }
Write-Host ''
Write-Host 'آیفون و کامپیوتر باید روی یک Wi-Fi باشند. پورت SMB را روی مودم/اینترنت Forward نکنید.'
