param(
    [string]$DnsName = "localhost",
    [string]$OutputDir = "$PSScriptRoot\certs",
    [switch]$TrustCurrentUserRoot
)

$ErrorActionPreference = "Stop"

function Convert-BytesToPem {
    param(
        [byte[]]$Bytes,
        [string]$Label
    )

    $base64 = [Convert]::ToBase64String($Bytes)
    $lines = for ($i = 0; $i -lt $base64.Length; $i += 64) {
        $base64.Substring($i, [Math]::Min(64, $base64.Length - $i))
    }
    @(
        "-----BEGIN $Label-----"
        $lines
        "-----END $Label-----"
    ) -join "`n"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$cert = New-SelfSignedCertificate `
    -DnsName $DnsName `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(1) `
    -FriendlyName "Exam System Local HTTPS"

$certificatePath = Join-Path $OutputDir "exam-system.crt"
$privateKeyPath = Join-Path $OutputDir "exam-system.key"
$temporaryPfxPath = Join-Path $OutputDir "exam-system.pfx"

$certPem = Convert-BytesToPem -Bytes $cert.RawData -Label "CERTIFICATE"
Set-Content -Path $certificatePath -Value $certPem -Encoding ascii

$rsa = $cert.GetRSAPrivateKey()
$exportMethod = $rsa.GetType().GetMethod("ExportPkcs8PrivateKey", [Type[]]@())
if ($exportMethod) {
    $privateKeyBytes = $rsa.ExportPkcs8PrivateKey()
    $keyPem = Convert-BytesToPem -Bytes $privateKeyBytes -Label "PRIVATE KEY"
    Set-Content -Path $privateKeyPath -Value $keyPem -Encoding ascii
} elseif (Get-Command openssl -ErrorAction SilentlyContinue) {
    $pfxPassword = [Guid]::NewGuid().ToString("N")
    $securePassword = ConvertTo-SecureString -String $pfxPassword -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $temporaryPfxPath -Password $securePassword | Out-Null
    openssl pkcs12 -in $temporaryPfxPath -nocerts -nodes -passin "pass:$pfxPassword" -out $privateKeyPath
    Remove-Item -Force $temporaryPfxPath
} else {
    throw "Private key PEM export requires PowerShell 7+ or OpenSSL on this machine."
}

if ($TrustCurrentUserRoot) {
    Import-Certificate -FilePath $certificatePath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
}

Write-Host "Created certificate: $certificatePath"
Write-Host "Created private key: $privateKeyPath"
Write-Host ""
Write-Host "Use deployment/nginx-exam-system-https.conf and replace:"
Write-Host "  SSL_CERT_PATH -> $($certificatePath -replace '\\', '/')"
Write-Host "  SSL_KEY_PATH  -> $($privateKeyPath -replace '\\', '/')"
Write-Host "  SERVER_DOMAIN -> $DnsName"
