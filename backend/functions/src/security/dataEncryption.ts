import * as crypto from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';

export interface EncryptionConfig {
  algorithms: {
    symmetric: 'aes-256-gcm' | 'aes-256-cbc';
    asymmetric: 'rsa' | 'ed25519';
    hashing: 'sha256' | 'sha512' | 'blake2b';
  };
  keyManagement: {
    rotationIntervalDays: number;
    keyDerivationIterations: number;
    saltLength: number;
  };
  dataClassification: {
    pii: { encryption: boolean; keyType: 'symmetric' | 'asymmetric' };
    financial: { encryption: boolean; keyType: 'symmetric' | 'asymmetric' };
    sensitive: { encryption: boolean; keyType: 'symmetric' | 'asymmetric' };
    public: { encryption: boolean; keyType: 'symmetric' | 'asymmetric' };
  };
}

export interface EncryptionKey {
  id: string;
  type: 'symmetric' | 'asymmetric';
  algorithm: string;
  keyData: string; // Base64 encoded
  publicKey?: string; // For asymmetric keys
  purpose: 'encryption' | 'signing' | 'kdf';
  status: 'active' | 'rotating' | 'deprecated' | 'revoked';
  metadata: {
    createdAt: Date;
    lastUsed: Date;
    rotationScheduled?: Date;
    usage: number;
    version: number;
  };
  restrictions?: {
    allowedOperations: ('encrypt' | 'decrypt' | 'sign' | 'verify')[];
    allowedDataTypes: string[];
    expiresAt?: Date;
  };
}

export interface EncryptedData {
  data: string; // Base64 encoded encrypted data
  keyId: string;
  algorithm: string;
  iv?: string; // Initialization vector (Base64)
  tag?: string; // Authentication tag for GCM (Base64)
  salt?: string; // Salt for key derivation (Base64)
  metadata: {
    encryptedAt: Date;
    dataType: string;
    version: number;
    checksum: string;
  };
}

export interface PIIField {
  fieldPath: string;
  dataType: 'email' | 'phone' | 'name' | 'address' | 'id_number' | 'financial' | 'sensitive';
  encryptionRequired: boolean;
  hashingRequired: boolean;
  tokenizationRequired: boolean;
}

export class DataEncryptionSystem {
  private db = getFirestore();
  private config: EncryptionConfig;
  private activeKeys: Map<string, EncryptionKey> = new Map();
  private keyCache: Map<string, Buffer> = new Map();

  constructor(config?: Partial<EncryptionConfig>) {
    this.config = {
      algorithms: {
        symmetric: 'aes-256-gcm',
        asymmetric: 'rsa',
        hashing: 'sha256',
        ...config?.algorithms
      },
      keyManagement: {
        rotationIntervalDays: 90,
        keyDerivationIterations: 100000,
        saltLength: 32,
        ...config?.keyManagement
      },
      dataClassification: {
        pii: { encryption: true, keyType: 'symmetric' },
        financial: { encryption: true, keyType: 'asymmetric' },
        sensitive: { encryption: true, keyType: 'symmetric' },
        public: { encryption: false, keyType: 'symmetric' },
        ...config?.dataClassification
      }
    };

    this.initializeEncryptionSystem();
  }

  async encryptData(
    data: any,
    dataType: 'pii' | 'financial' | 'sensitive' | 'public',
    options?: {
      keyId?: string;
      additionalData?: string;
      compression?: boolean;
    }
  ): Promise<EncryptedData> {
    try {
      // Check if encryption is required for this data type
      const typeConfig = this.config.dataClassification[dataType];
      if (!typeConfig.encryption) {
        throw new Error(`Encryption not configured for data type: ${dataType}`);
      }

      // Serialize data
      const serializedData = JSON.stringify(data);
      const dataBuffer = Buffer.from(serializedData, 'utf8');

      // Get or generate encryption key
      const encryptionKey = options?.keyId 
        ? await this.getKey(options.keyId)
        : await this.getActiveKeyForType(typeConfig.keyType);

      if (!encryptionKey) {
        throw new Error('No active encryption key available');
      }

      // Perform encryption based on key type
      let encryptedResult: {
        encryptedData: Buffer;
        iv?: Buffer;
        tag?: Buffer;
        salt?: Buffer;
      };

      if (encryptionKey.type === 'symmetric') {
        encryptedResult = await this.encryptSymmetric(dataBuffer, encryptionKey, options?.additionalData);
      } else {
        encryptedResult = await this.encryptAsymmetric(dataBuffer, encryptionKey);
      }

      // Calculate checksum
      const checksum = crypto
        .createHash(this.config.algorithms.hashing)
        .update(dataBuffer)
        .digest('hex');

      // Update key usage
      await this.updateKeyUsage(encryptionKey.id);

      const encryptedData: EncryptedData = {
        data: encryptedResult.encryptedData.toString('base64'),
        keyId: encryptionKey.id,
        algorithm: encryptionKey.algorithm,
        iv: encryptedResult.iv?.toString('base64'),
        tag: encryptedResult.tag?.toString('base64'),
        salt: encryptedResult.salt?.toString('base64'),
        metadata: {
          encryptedAt: new Date(),
          dataType,
          version: 1,
          checksum
        }
      };

      logger.info('Data encrypted successfully', {
        keyId: encryptionKey.id,
        dataType,
        algorithm: encryptionKey.algorithm,
        dataSize: dataBuffer.length
      });

      return encryptedData;

    } catch (error) {
      logger.error('Data encryption failed', error as Error, { dataType });
      throw error;
    }
  }

  async decryptData(encryptedData: EncryptedData): Promise<any> {
    try {
      // Get decryption key
      const decryptionKey = await this.getKey(encryptedData.keyId);
      if (!decryptionKey) {
        throw new Error(`Decryption key not found: ${encryptedData.keyId}`);
      }

      if (decryptionKey.status === 'revoked') {
        throw new Error('Cannot decrypt with revoked key');
      }

      // Decode encrypted data
      const encryptedBuffer = Buffer.from(encryptedData.data, 'base64');
      const iv = encryptedData.iv ? Buffer.from(encryptedData.iv, 'base64') : undefined;
      const tag = encryptedData.tag ? Buffer.from(encryptedData.tag, 'base64') : undefined;
      const salt = encryptedData.salt ? Buffer.from(encryptedData.salt, 'base64') : undefined;

      // Perform decryption based on key type
      let decryptedBuffer: Buffer;

      if (decryptionKey.type === 'symmetric') {
        decryptedBuffer = await this.decryptSymmetric(
          encryptedBuffer,
          decryptionKey,
          { iv, tag, salt }
        );
      } else {
        decryptedBuffer = await this.decryptAsymmetric(encryptedBuffer, decryptionKey);
      }

      // Verify checksum
      const calculatedChecksum = crypto
        .createHash(this.config.algorithms.hashing)
        .update(decryptedBuffer)
        .digest('hex');

      if (calculatedChecksum !== encryptedData.metadata.checksum) {
        throw new Error('Data integrity check failed - checksum mismatch');
      }

      // Deserialize data
      const decryptedString = decryptedBuffer.toString('utf8');
      const originalData = JSON.parse(decryptedString);

      // Update key usage
      await this.updateKeyUsage(decryptionKey.id);

      logger.info('Data decrypted successfully', {
        keyId: decryptionKey.id,
        dataType: encryptedData.metadata.dataType,
        algorithm: encryptedData.algorithm
      });

      return originalData;

    } catch (error) {
      logger.error('Data decryption failed', error as Error, {
        keyId: encryptedData.keyId,
        algorithm: encryptedData.algorithm
      });
      throw error;
    }
  }

  async encryptPII(piiData: Record<string, any>, piiFields: PIIField[]): Promise<Record<string, any>> {
    try {
      const encryptedData = { ...piiData };

      for (const field of piiFields) {
        const value = this.getNestedValue(piiData, field.fieldPath);
        if (value === undefined || value === null) continue;

        if (field.encryptionRequired) {
          const encrypted = await this.encryptData(value, 'pii');
          this.setNestedValue(encryptedData, field.fieldPath, encrypted);
        }

        if (field.hashingRequired) {
          const hashedValue = await this.hashData(value, field.dataType);
          this.setNestedValue(encryptedData, `${field.fieldPath}_hash`, hashedValue);
        }

        if (field.tokenizationRequired) {
          const token = await this.tokenizeData(value, field.dataType);
          this.setNestedValue(encryptedData, `${field.fieldPath}_token`, token);
        }
      }

      return encryptedData;

    } catch (error) {
      logger.error('PII encryption failed', error as Error);
      throw error;
    }
  }

  async decryptPII(encryptedData: Record<string, any>, piiFields: PIIField[]): Promise<Record<string, any>> {
    try {
      const decryptedData = { ...encryptedData };

      for (const field of piiFields) {
        if (field.encryptionRequired) {
          const encryptedValue = this.getNestedValue(encryptedData, field.fieldPath);
          if (encryptedValue && typeof encryptedValue === 'object' && encryptedValue.data) {
            const decrypted = await this.decryptData(encryptedValue as EncryptedData);
            this.setNestedValue(decryptedData, field.fieldPath, decrypted);
          }
        }
      }

      return decryptedData;

    } catch (error) {
      logger.error('PII decryption failed', error as Error);
      throw error;
    }
  }

  async hashData(data: any, dataType: string, options?: { salt?: string; pepper?: string }): Promise<string> {
    try {
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      const salt = options?.salt || crypto.randomBytes(this.config.keyManagement.saltLength).toString('hex');
      const pepper = options?.pepper || process.env.ENCRYPTION_PEPPER || '';

      // Combine data with salt and pepper
      const combinedData = `${dataString}${salt}${pepper}`;

      // Create hash
      const hash = crypto
        .createHash(this.config.algorithms.hashing)
        .update(combinedData)
        .digest('hex');

      // Store salt with hash for verification
      return `${salt}:${hash}`;

    } catch (error) {
      logger.error('Data hashing failed', error as Error, { dataType });
      throw error;
    }
  }

  async verifyHash(data: any, hashedData: string, dataType: string): Promise<boolean> {
    try {
      const [salt, hash] = hashedData.split(':');
      if (!salt || !hash) {
        return false;
      }

      const recalculatedHash = await this.hashData(data, dataType, { salt });
      return recalculatedHash === hashedData;

    } catch (error) {
      logger.error('Hash verification failed', error as Error);
      return false;
    }
  }

  private async encryptSymmetric(
    data: Buffer,
    key: EncryptionKey,
    additionalData?: string
  ): Promise<{
    encryptedData: Buffer;
    iv: Buffer;
    tag?: Buffer;
    salt?: Buffer;
  }> {
    const keyBuffer = await this.getKeyBuffer(key);
    const iv = crypto.randomBytes(16);

    if (this.config.algorithms.symmetric === 'aes-256-gcm') {
      const cipher = crypto.createCipher('aes-256-gcm', keyBuffer);
      cipher.setAAD(Buffer.from(additionalData || '', 'utf8'));
      
      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const tag = cipher.getAuthTag();

      return {
        encryptedData: encrypted,
        iv,
        tag
      };
    } else {
      // AES-256-CBC
      const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      return {
        encryptedData: encrypted,
        iv
      };
    }
  }

  private async decryptSymmetric(
    encryptedData: Buffer,
    key: EncryptionKey,
    options: { iv?: Buffer; tag?: Buffer; salt?: Buffer }
  ): Promise<Buffer> {
    const keyBuffer = await this.getKeyBuffer(key);

    if (!options.iv) {
      throw new Error('IV required for symmetric decryption');
    }

    if (this.config.algorithms.symmetric === 'aes-256-gcm') {
      if (!options.tag) {
        throw new Error('Authentication tag required for GCM decryption');
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, options.iv);
      decipher.setAuthTag(options.tag);

      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted;
    } else {
      // AES-256-CBC
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, options.iv);
      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted;
    }
  }

  private async encryptAsymmetric(
    data: Buffer,
    key: EncryptionKey
  ): Promise<{
    encryptedData: Buffer;
  }> {
    const publicKey = key.publicKey;
    if (!publicKey) {
      throw new Error('Public key required for asymmetric encryption');
    }

    // For large data, use hybrid encryption (RSA for key, AES for data)
    if (data.length > 190) { // RSA-2048 can encrypt max ~190 bytes
      return this.hybridEncrypt(data, key);
    }

    const encrypted = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      data
    );

    return { encryptedData: encrypted };
  }

  private async decryptAsymmetric(
    encryptedData: Buffer,
    key: EncryptionKey
  ): Promise<Buffer> {
    const keyBuffer = await this.getKeyBuffer(key);

    // Check if this is hybrid encryption
    if (encryptedData.length > 256) { // Typical RSA encrypted key size
      return this.hybridDecrypt(encryptedData, key);
    }

    const decrypted = crypto.privateDecrypt(
      {
        key: keyBuffer,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      encryptedData
    );

    return decrypted;
  }

  private async hybridEncrypt(
    data: Buffer,
    asymmetricKey: EncryptionKey
  ): Promise<{
    encryptedData: Buffer;
  }> {
    // Generate random AES key
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);

    // Encrypt data with AES
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    let encryptedData = cipher.update(data);
    encryptedData = Buffer.concat([encryptedData, cipher.final()]);
    const tag = cipher.getAuthTag();

    // Encrypt AES key with RSA
    const encryptedKey = crypto.publicEncrypt(
      {
        key: asymmetricKey.publicKey!,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      aesKey
    );

    // Combine encrypted key, IV, tag, and data
    const keyLength = Buffer.alloc(4);
    keyLength.writeUInt32BE(encryptedKey.length, 0);

    const combined = Buffer.concat([
      keyLength,
      encryptedKey,
      iv,
      tag,
      encryptedData
    ]);

    return { encryptedData: combined };
  }

  private async hybridDecrypt(
    encryptedData: Buffer,
    asymmetricKey: EncryptionKey
  ): Promise<Buffer> {
    // Extract components
    let offset = 0;
    const keyLength = encryptedData.readUInt32BE(offset);
    offset += 4;

    const encryptedKey = encryptedData.slice(offset, offset + keyLength);
    offset += keyLength;

    const iv = encryptedData.slice(offset, offset + 16);
    offset += 16;

    const tag = encryptedData.slice(offset, offset + 16);
    offset += 16;

    const encryptedPayload = encryptedData.slice(offset);

    // Decrypt AES key with RSA
    const keyBuffer = await this.getKeyBuffer(asymmetricKey);
    const aesKey = crypto.privateDecrypt(
      {
        key: keyBuffer,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      encryptedKey
    );

    // Decrypt data with AES
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedPayload);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted;
  }

  async generateKey(
    type: 'symmetric' | 'asymmetric',
    purpose: 'encryption' | 'signing' | 'kdf',
    options?: {
      algorithm?: string;
      keySize?: number;
      restrictions?: EncryptionKey['restrictions'];
    }
  ): Promise<EncryptionKey> {
    try {
      const keyId = `key_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      let keyData: string;
      let publicKey: string | undefined;
      let algorithm: string;

      if (type === 'symmetric') {
        algorithm = options?.algorithm || this.config.algorithms.symmetric;
        const keySize = options?.keySize || 32; // 256 bits
        const key = crypto.randomBytes(keySize);
        keyData = key.toString('base64');
      } else {
        algorithm = options?.algorithm || this.config.algorithms.asymmetric;
        const keySize = options?.keySize || 2048;

        const { privateKey, publicKey: pubKey } = crypto.generateKeyPairSync('rsa', {
          modulusLength: keySize,
          privateKeyFormat: {
            type: 'pkcs8',
            format: 'pem'
          },
          publicKeyFormat: {
            type: 'spki',
            format: 'pem'
          }
        });

        keyData = Buffer.from(privateKey).toString('base64');
        publicKey = pubKey;
      }

      const encryptionKey: EncryptionKey = {
        id: keyId,
        type,
        algorithm,
        keyData,
        publicKey,
        purpose,
        status: 'active',
        metadata: {
          createdAt: new Date(),
          lastUsed: new Date(),
          usage: 0,
          version: 1
        },
        restrictions: options?.restrictions
      };

      // Store key securely
      await this.storeKey(encryptionKey);

      // Cache key
      this.activeKeys.set(keyId, encryptionKey);

      logger.info('Encryption key generated', {
        keyId,
        type,
        algorithm,
        purpose
      });

      return encryptionKey;

    } catch (error) {
      logger.error('Key generation failed', error as Error, { type, purpose });
      throw error;
    }
  }

  async rotateKey(keyId: string): Promise<EncryptionKey> {
    try {
      const oldKey = await this.getKey(keyId);
      if (!oldKey) {
        throw new Error(`Key not found: ${keyId}`);
      }

      // Generate new key with same properties
      const newKey = await this.generateKey(oldKey.type, oldKey.purpose, {
        algorithm: oldKey.algorithm,
        restrictions: oldKey.restrictions
      });

      // Mark old key as deprecated
      oldKey.status = 'deprecated';
      oldKey.metadata.rotationScheduled = new Date();
      await this.updateKey(oldKey);

      logger.info('Key rotated successfully', {
        oldKeyId: keyId,
        newKeyId: newKey.id
      });

      return newKey;

    } catch (error) {
      logger.error('Key rotation failed', error as Error, { keyId });
      throw error;
    }
  }

  private async tokenizeData(data: any, dataType: string): Promise<string> {
    // Generate format-preserving token
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');
    
    // Create token based on data type
    switch (dataType) {
      case 'email':
        return `token_${hash.substring(0, 8)}@tokenized.local`;
      case 'phone':
        return `+33${hash.substring(0, 9)}`;
      case 'id_number':
        return `TOK${hash.substring(0, 10).toUpperCase()}`;
      default:
        return `TOKEN_${hash.substring(0, 16).toUpperCase()}`;
    }
  }

  private async initializeEncryptionSystem(): Promise<void> {
    try {
      // Load active keys
      await this.loadActiveKeys();

      // Check if master keys exist, create if not
      await this.ensureMasterKeys();

      // Schedule key rotation checks
      this.scheduleKeyRotation();

      logger.info('Encryption system initialized', {
        activeKeys: this.activeKeys.size,
        config: this.config
      });

    } catch (error) {
      logger.error('Failed to initialize encryption system', error as Error);
      throw error;
    }
  }

  private async loadActiveKeys(): Promise<void> {
    try {
      const snapshot = await this.db.collection('encryption_keys')
        .where('status', '==', 'active')
        .get();

      snapshot.docs.forEach(doc => {
        const key = doc.data() as EncryptionKey;
        this.activeKeys.set(key.id, key);
      });

    } catch (error) {
      logger.error('Failed to load active keys', error as Error);
    }
  }

  private async ensureMasterKeys(): Promise<void> {
    const requiredKeys = [
      { type: 'symmetric' as const, purpose: 'encryption' as const },
      { type: 'asymmetric' as const, purpose: 'encryption' as const },
      { type: 'symmetric' as const, purpose: 'kdf' as const }
    ];

    for (const keySpec of requiredKeys) {
      const existingKey = Array.from(this.activeKeys.values()).find(
        key => key.type === keySpec.type && key.purpose === keySpec.purpose
      );

      if (!existingKey) {
        await this.generateKey(keySpec.type, keySpec.purpose);
      }
    }
  }

  private scheduleKeyRotation(): void {
    // Check for key rotation every 24 hours
    setInterval(async () => {
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.keyManagement.rotationIntervalDays);

        for (const key of this.activeKeys.values()) {
          if (key.metadata.createdAt < cutoffDate && key.status === 'active') {
            await this.rotateKey(key.id);
          }
        }
      } catch (error) {
        logger.error('Scheduled key rotation failed', error as Error);
      }
    }, 24 * 60 * 60 * 1000);
  }

  private async getKey(keyId: string): Promise<EncryptionKey | null> {
    // Check cache first
    if (this.activeKeys.has(keyId)) {
      return this.activeKeys.get(keyId)!;
    }

    // Load from database
    try {
      const keyDoc = await firestoreHelper.getDocumentOptional('encryption_keys', keyId);
      if (keyDoc) {
        const key = keyDoc as EncryptionKey;
        this.activeKeys.set(keyId, key);
        return key;
      }
    } catch (error) {
      logger.error('Failed to get key', error as Error, { keyId });
    }

    return null;
  }

  private async getActiveKeyForType(type: 'symmetric' | 'asymmetric'): Promise<EncryptionKey | null> {
    const keys = Array.from(this.activeKeys.values()).filter(
      key => key.type === type && key.purpose === 'encryption' && key.status === 'active'
    );

    // Return the newest key
    return keys.sort((a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime())[0] || null;
  }

  private async getKeyBuffer(key: EncryptionKey): Promise<Buffer> {
    // Check cache
    if (this.keyCache.has(key.id)) {
      return this.keyCache.get(key.id)!;
    }

    // Decode key data
    const keyBuffer = Buffer.from(key.keyData, 'base64');
    
    // Cache for performance (with reasonable cache size limit)
    if (this.keyCache.size < 100) {
      this.keyCache.set(key.id, keyBuffer);
    }

    return keyBuffer;
  }

  private async storeKey(key: EncryptionKey): Promise<void> {
    await firestoreHelper.setDocument('encryption_keys', key.id, key);
  }

  private async updateKey(key: EncryptionKey): Promise<void> {
    await firestoreHelper.updateDocument('encryption_keys', key.id, {
      status: key.status,
      metadata: key.metadata
    });
    
    // Update cache
    this.activeKeys.set(key.id, key);
  }

  private async updateKeyUsage(keyId: string): Promise<void> {
    const key = this.activeKeys.get(keyId);
    if (key) {
      key.metadata.lastUsed = new Date();
      key.metadata.usage += 1;
      await this.updateKey(key);
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const props = path.split('.');
    const last = props.pop()!;
    const target = props.reduce((current, prop) => {
      if (!(prop in current)) current[prop] = {};
      return current[prop];
    }, obj);
    target[last] = value;
  }

  // Public management methods
  async getKeyInfo(keyId: string): Promise<Omit<EncryptionKey, 'keyData'> | null> {
    const key = await this.getKey(keyId);
    if (!key) return null;

    const { keyData, ...keyInfo } = key;
    return keyInfo;
  }

  async listKeys(): Promise<Omit<EncryptionKey, 'keyData'>[]> {
    try {
      const snapshot = await this.db.collection('encryption_keys').get();
      return snapshot.docs.map(doc => {
        const { keyData, ...keyInfo } = doc.data() as EncryptionKey;
        return keyInfo;
      });
    } catch (error) {
      logger.error('Failed to list keys', error as Error);
      return [];
    }
  }

  async revokeKey(keyId: string, reason: string): Promise<void> {
    const key = await this.getKey(keyId);
    if (!key) {
      throw new Error(`Key not found: ${keyId}`);
    }

    key.status = 'revoked';
    key.metadata.lastUpdated = new Date();
    await this.updateKey(key);

    // Remove from cache
    this.activeKeys.delete(keyId);
    this.keyCache.delete(keyId);

    logger.info('Key revoked', { keyId, reason });
  }
}

// Singleton instance
export const dataEncryptionSystem = new DataEncryptionSystem();