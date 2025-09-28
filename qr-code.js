export const startQrScanner = (videoElement, onScan) => {
    const codeReader = new ZXing.BrowserQRCodeReader();
    codeReader.decodeFromVideoElement(videoElement, 'video', (result, err) => {
        if (result) {
            onScan(result.text);
            codeReader.reset();
        }
    });
};