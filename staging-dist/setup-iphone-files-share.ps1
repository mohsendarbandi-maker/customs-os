# Customs OS - secure SMB share for the iPhone Files app
# Run in Windows PowerShell as Administrator.
# The firewall rule is limited to trusted Private/Domain networks and the local subnet.
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'PowerShell را با گزینه Run as administrator اجرا کنید.'
}

# Validate the network BEFORE creating a Windows account or changing folder permissions.
$activeProfiles = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' })
$trustedProfiles = @($activeProfiles | Where-Object { $_.NetworkCategory -in @('Private', 'DomainAuthenticated') })
if ($trustedProfiles.Count -eq 0) {
  foreach ($profile in $activeProfiles | Where-Object { $_.NetworkCategory -eq 'Public' }) {
    $answer = Read-Host ("شبکه «{0}» عمومی است. فقط اگر این شبکه Wi-Fi/شبکهٔ مطمئن شرکت است آن را Private کنیم؟ (Y/N)" -f $profile.Name)
    if ($answer -match '^(Y|YES)$') {
      Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private
    }
  }
  $activeProfiles = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' })
  $trustedProfiles = @($activeProfiles | Where-Object { $_.NetworkCategory -in @('Private', 'DomainAuthenticated') })
}
if ($trustedProfiles.Count -eq 0) {
  throw 'هیچ اتصال Private یا Domain معتبر پیدا نشد. برای امنیت، اشتراک‌گذاری روی شبکه Public فعال نشد. به Wi-Fi مطمئن شرکت وصل شوید و اجرای اسکریپت را تکرار کنید.'
}

Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'پوشه Darbandi Commercial را انتخاب کنید؛ همان پوشه‌ای که فایل‌منیجر در آن همگام‌سازی می‌کند.'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Host 'لغو شد.' -ForegroundColor Yellow
  exit 1
}
$sharePath = $dialog.SelectedPath
if (-not (Test-Path -LiteralPath $sharePath -PathType Container)) {
  throw 'پوشه انتخاب‌شده وجود ندارد.'
}

$shareName = 'DarbandiCommercial'
$userName = 'DarbandiFiles'
$existingUser = Get-LocalUser -Name $userName -ErrorAction SilentlyContinue
$newCredential = $false
if ($existingUser) {
  Write-Host "کاربر محلی $userName از قبل وجود دارد؛ رمز فعلی حفظ می‌شود." -ForegroundColor Yellow
} else {
  $sharePassword = Read-Host 'برای اتصال آیفون یک رمز قوی وارد کنید' -AsSecureString
  if (-not $sharePassword -or $sharePassword.Length -lt 12) {
    throw 'رمز باید حداقل ۱۲ نویسه داشته باشد.'
  }
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
if ($LASTEXITCODE -ne 0) {
  throw 'اعمال مجوز فایل‌سیستم کامل نشد؛ پوشه و مجوزهای آن را بررسی کنید.'
}

# SMBv1 remains disabled.
Set-SmbServerConfiguration -EnableSMB2Protocol $true -EnableSMB1Protocol $false -Force | Out-Null

# Remove the prior named rule and replace it with a Private/Domain-only LAN rule.
$oldRuleNames = @(
  'Customs OS iPhone Files SMB (Private LAN only)',
  'Customs OS iPhone Files SMB (Private or Domain LAN only)'
)
foreach ($oldRuleName in $oldRuleNames) {
  $oldRule = Get-NetFirewallRule -DisplayName $oldRuleName -ErrorAction SilentlyContinue
  if ($oldRule) { Remove-NetFirewallRule -DisplayName $oldRuleName }
}
New-NetFirewallRule -DisplayName 'Customs OS iPhone Files SMB (Private or Domain LAN only)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 445 -Profile Private,Domain -RemoteAddress LocalSubnet | Out-Null

# Show only IP addresses belonging to the trusted network interfaces.
$addresses = @(
  foreach ($profile in $trustedProfiles) {
    Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $profile.InterfaceIndex |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.AddressState -eq 'Preferred'
      } |
      ForEach-Object {
        [PSCustomObject]@{
          Interface = $profile.InterfaceAlias
          IPAddress = $_.IPAddress
        }
      }
  }
) | Sort-Object Interface, IPAddress -Unique
if (-not $addresses -or $addresses.Count -eq 0) {
  throw 'روی شبکه Private/Domain آدرس IPv4 پیدا نشد. اتصال شبکه را بررسی کنید.'
}

Write-Host ''
Write-Host 'اشتراک‌گذاری امن محلی آماده شد.' -ForegroundColor Green
Write-Host "Share: \\$env:COMPUTERNAME\$shareName"
Write-Host "Username: $env:COMPUTERNAME\$userName"
if ($newCredential) {
  Write-Host 'رمز را فقط در آیفون وارد کنید؛ این اسکریپت آن را ذخیره نمی‌کند.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'در iPhone > Files > Browse > … > Connect to Server یکی از آدرس‌های زیر را وارد کنید:'
foreach ($item in $addresses) {
  Write-Host ("{0}: smb://{1}" -f $item.Interface, $item.IPAddress) -ForegroundColor Cyan
}
Write-Host ''
Write-Host 'آیفون و کامپیوتر باید به یک Wi-Fi یا VPN خصوصی دسترسی داشته باشند.'
Write-Host 'پورت SMB را روی مودم/اینترنت Forward نکنید؛ فایروال فقط شبکه Private/Domain و LocalSubnet را مجاز می‌کند.'
