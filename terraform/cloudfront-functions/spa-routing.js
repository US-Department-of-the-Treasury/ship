// CloudFront Function for SPA routing
// Rewrites requests for SPA routes to /index.html while passing through static assets
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // Check if the URI has a file extension (static asset)
    var hasExtension = /\.(html|css|js|json|ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|map|txt|xml|webmanifest)$/i.test(uri);

    // If no file extension, rewrite to index.html for SPA routing
    if (!hasExtension && uri !== '/') {
        request.uri = '/index.html';
    }

    return request;
}
