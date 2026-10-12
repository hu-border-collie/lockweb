// A synthetic authenticator with real ES256 signatures and stable PRF evaluation.
// This fixture does not simulate an operating-system biometric ceremony.
export async function syntheticAuthenticator(
  origin = "https://journal.example",
  rpId = "journal.example",
) {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", keys.publicKey),
    id = crypto.getRandomValues(new Uint8Array(32));
  const master = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const enc = new TextEncoder();
  const b64 = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  const buffer = (value: BufferSource) =>
    value instanceof ArrayBuffer
      ? value
      : (value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ) as ArrayBuffer);
  const controls = {
    createPrf: true,
    getPrf: true,
    uv: true,
    wrongChallenge: false,
    wrongOrigin: false,
    wrongId: false,
    badSignature: false,
    wrongPrf: false,
    cancel: false,
    hold: null as (() => Promise<void>) | null,
  };
  function der(raw: Uint8Array) {
    const parts = [raw.slice(0, 32), raw.slice(32)];
    const encoded = parts.map((p) => {
      while (p.length > 1 && p[0] === 0) p = p.slice(1);
      if (p[0] & 128) p = new Uint8Array([0, ...p]);
      return new Uint8Array([2, p.length, ...p]);
    });
    return new Uint8Array([
      0x30,
      encoded[0].length + encoded[1].length,
      ...encoded[0],
      ...encoded[1],
    ]).buffer;
  }
  async function response(type: string, challenge: BufferSource) {
    const json = enc.encode(
      JSON.stringify({
        type,
        challenge: controls.wrongChallenge
          ? "wrong"
          : b64(new Uint8Array(buffer(challenge))),
        origin: controls.wrongOrigin ? "https://other.example" : origin,
        crossOrigin: false,
      }),
    );
    const auth = new Uint8Array(37);
    auth.set(
      new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(rpId))),
    );
    auth[32] = controls.uv ? 5 : 1;
    return { clientDataJSON: json.buffer, authenticatorData: auth.buffer };
  }
  const create = async (options: CredentialCreationOptions) => {
    if (controls.cancel) throw new DOMException("cancelled", "NotAllowedError");
    const data = await response(
      "webauthn.create",
      options.publicKey!.challenge,
    );
    return {
      type: "public-key",
      rawId: id.slice().buffer,
      response: {
        clientDataJSON: data.clientDataJSON,
        getAuthenticatorData: () => data.authenticatorData,
        getPublicKey: () => spki,
        getPublicKeyAlgorithm: () => -7,
      },
      getClientExtensionResults: () => ({
        prf: { enabled: controls.createPrf },
      }),
    } as unknown as PublicKeyCredential;
  };
  const get = async (options: CredentialRequestOptions) => {
    if (controls.cancel) throw new DOMException("cancelled", "NotAllowedError");
    if (controls.hold) await controls.hold();
    const data = await response("webauthn.get", options.publicKey!.challenge);
    const hash = new Uint8Array(
        await crypto.subtle.digest("SHA-256", data.clientDataJSON),
      ),
      signed = new Uint8Array(69);
    signed.set(new Uint8Array(data.authenticatorData));
    signed.set(hash, 37);
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        signed,
      ),
    );
    if (controls.badSignature) raw[0] ^= 1;
    const value = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        master,
        buffer(options.publicKey!.extensions!.prf!.eval!.first),
      ),
    );
    if (controls.wrongPrf) value[0] ^= 1;
    return {
      type: "public-key",
      rawId: controls.wrongId ? new Uint8Array([0]).buffer : id.slice().buffer,
      response: { ...data, signature: der(raw), userHandle: null },
      getClientExtensionResults: () => ({
        prf: controls.getPrf ? { results: { first: value.buffer } } : {},
      }),
    } as unknown as PublicKeyCredential;
  };
  return { create, get, controls, publicKey: spki };
}
