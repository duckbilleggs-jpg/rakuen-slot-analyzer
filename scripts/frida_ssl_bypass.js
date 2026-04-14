/**
 * Frida SSL Pinning Bypass Script
 * マルハンアプリのSSL証明書検証を無効化して mitmproxy での傍受を可能にする
 * 
 * 使い方:
 *   frida -U -f <パッケージ名> -l scripts/frida_ssl_bypass.js --no-pause
 */

Java.perform(function () {
    console.log("[*] SSL Pinning バイパス開始...");

    // --- TrustManager バイパス ---
    try {
        var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
        TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
            console.log("[+] TrustManagerImpl.verifyChain バイパス: " + host);
            return untrustedChain;
        };
    } catch (e) {
        console.log("[-] TrustManagerImpl not found: " + e);
    }

    // --- X509TrustManager バイパス ---
    try {
        var X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
        var SSLContext = Java.use('javax.net.ssl.SSLContext');
        var TrustManager = Java.registerClass({
            name: 'dev.bypass.TrustManager',
            implements: [X509TrustManager],
            methods: {
                checkClientTrusted: function (chain, authType) { },
                checkServerTrusted: function (chain, authType) { },
                getAcceptedIssuers: function () { return []; }
            }
        });
        var TrustManagers = [TrustManager.$new()];
        var sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, TrustManagers, null);
        SSLContext.getInstance.overload("java.lang.String").implementation = function (protocol) {
            console.log("[+] SSLContext.getInstance バイパス: " + protocol);
            var ctx = this.getInstance(protocol);
            ctx.init(null, TrustManagers, null);
            return ctx;
        };
    } catch (e) {
        console.log("[-] X509TrustManager bypass error: " + e);
    }

    // --- OkHTTP CertificatePinner バイパス ---
    try {
        var CertificatePinner = Java.use('okhttp3.CertificatePinner');
        CertificatePinner.check.overload('java.lang.String', 'java.util.List').implementation = function (hostname, peerCertificates) {
            console.log("[+] OkHTTP CertificatePinner.check バイパス: " + hostname);
        };
    } catch (e) {
        console.log("[-] OkHTTP CertificatePinner not found: " + e);
    }

    // --- OkHTTP3 v4 CertificatePinner バイパス ---
    try {
        var CertificatePinner2 = Java.use('okhttp3.CertificatePinner');
        CertificatePinner2.check$okhttp.implementation = function (hostname, sha256) {
            console.log("[+] OkHTTP3 v4 CertificatePinner バイパス: " + hostname);
        };
    } catch (e) {
        console.log("[-] OkHTTP3 v4 CertificatePinner not found: " + e);
    }

    // --- WebViewClient SSL Error バイパス ---
    try {
        var WebViewClient = Java.use('android.webkit.WebViewClient');
        WebViewClient.onReceivedSslError.implementation = function (webView, handler, error) {
            console.log("[+] WebViewClient SSL Error バイパス");
            handler.proceed();
        };
    } catch (e) {
        console.log("[-] WebViewClient bypass error: " + e);
    }

    // --- Network Security Config バイパス ---
    try {
        var NetworkSecurityConfig = Java.use('android.security.net.config.NetworkSecurityConfig');
        NetworkSecurityConfig.isCleartextTrafficPermitted.overload().implementation = function () {
            console.log("[+] Cleartext traffic 許可");
            return true;
        };
    } catch (e) {
        console.log("[-] NetworkSecurityConfig not found: " + e);
    }

    console.log("[*] SSL Pinning バイパス完了！");
});
