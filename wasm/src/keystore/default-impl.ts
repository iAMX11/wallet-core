// SPDX-License-Identifier: Apache-2.0
//
// Copyright © 2017 Trust Wallet.

import {WalletCore, CoinType, Derivation, PrivateKey, StoredKey, StoredKeyEncryption} from "../wallet-core";
import * as Types from "./types";

export class Default implements Types.IKeyStore {
  private readonly core: WalletCore;
  private readonly storage: Types.IStorage;

  constructor(core: WalletCore, storage: Types.IStorage) {
    this.core = core;
    this.storage = storage;
  }

  hasWallet(id: string): Promise<boolean> {
    return this.storage
      .get(id)
      .then((wallet) => true)
      .catch((error) => false);
  }

  load(id: string): Promise<Types.Wallet> {
    return this.storage.get(id);
  }

  loadAll(): Promise<Types.Wallet[]> {
    return this.storage.loadAll();
  }

  delete(id: string, password: string): Promise<void> {
    return this.storage.delete(id, password);
  }

  mapWallet(storedKey: StoredKey): Types.Wallet {
    const json = storedKey.exportJSON();
    return JSON.parse(Buffer.from(json).toString()) as Types.Wallet;
  }

  mapStoredKey(wallet: Types.Wallet): StoredKey {
    const json = Buffer.from(JSON.stringify(wallet));
    return this.core.StoredKey.importJSON(json);
  }

  importWallet(wallet: Types.Wallet): Promise<void> {
    return this.storage.set(wallet.id, wallet);
  }

  import(
    mnemonic: string,
    name: string,
    password: string,
    coins: CoinType[],
    encryption: StoredKeyEncryption
  ): Promise<Types.Wallet> {
    return new Promise((resolve, reject) => {
      const { Mnemonic, StoredKey, HDWallet, StoredKeyEncryption } = this.core;

      if (!Mnemonic.isValid(mnemonic)) {
        throw Types.Error.InvalidMnemonic;
      }
      let pass = Buffer.from(password);
      let storedKey = StoredKey.importHDWalletWithEncryption(mnemonic, name, pass, coins[0], encryption);
      let hdWallet = HDWallet.createWithMnemonic(mnemonic, "");
      coins.forEach((coin) => {
        storedKey.accountForCoin(coin, hdWallet);
      });
      let wallet = this.mapWallet(storedKey);

      storedKey.delete();
      hdWallet.delete();

      this.importWallet(wallet)
        .then(() => resolve(wallet))
        .catch((error) => reject(error));
    });
  }

  importKey(
    key: Uint8Array,
    name: string,
    password: string,
    coin: CoinType,
    encryption: StoredKeyEncryption,
    derivation: Derivation
  ): Promise<Types.Wallet> {
    return new Promise((resolve, reject) => {
      const { StoredKey, PrivateKey, Curve, StoredKeyEncryption } = this.core;

      // FIXME: get curve from coin
      if (
        !PrivateKey.isValid(key, Curve.secp256k1) ||
        !PrivateKey.isValid(key, Curve.ed25519)
      ) {
        throw Types.Error.InvalidKey;
      }
      let pass = Buffer.from(password);
      let storedKey = StoredKey.importPrivateKeyWithEncryptionAndDerivation(key, name, pass, coin, encryption, derivation);
      let wallet = this.mapWallet(storedKey);
      storedKey.delete();
      this.importWallet(wallet)
        .then(() => resolve(wallet))
        .catch((error) => reject(error));
    });
  }

  importKeyEncoded(
    key: string,
    name: string,
    password: string,
    coin: CoinType,
    encryption: StoredKeyEncryption,
    derivation: Derivation
  ): Promise<Types.Wallet> {
    return new Promise((resolve, reject) => {
      const { StoredKey, PrivateKey, Curve, StoredKeyEncryption } = this.core;

      let pass = Buffer.from(password);
      let storedKey = StoredKey.importPrivateKeyEncodedWithEncryptionAndDerivation(key, name, pass, coin, encryption, derivation);
      let wallet = this.mapWallet(storedKey);
      storedKey.delete();
      this.importWallet(wallet)
        .then(() => resolve(wallet))
        .catch((error) => reject(error));
    });
  }

  addAccounts(
    id: string,
    password: string,
    coins: CoinType[]
  ): Promise<Types.Wallet> {
    const { Derivation } = this.core;

    let coins_with_derivations = coins.map(coin => ({
      coin: coin,
      derivation: Derivation.default,
    }));
    return this.addAccountsWithDerivations(id, password, coins_with_derivations);
  }

  addAccountsWithDerivations(id: string, password: string, coins: Types.CoinWithDerivation[]): Promise<Types.Wallet> {
    return this.load(id).then((wallet) => {
      let storedKey = this.mapStoredKey(wallet);
      let hdWallet = storedKey.wallet(Buffer.from(password));
      coins.forEach((item) => {
        storedKey.accountForCoinDerivation(item.coin, item.derivation, hdWallet);
      });
      let newWallet = this.mapWallet(storedKey);
      storedKey.delete();
      hdWallet.delete();
      return this.importWallet(newWallet).then(() => newWallet);
    });
  }

  getKey(
    id: string,
    password: string,
    account: Types.ActiveAccount
  ): Promise<PrivateKey> {
    return this.load(id).then((wallet) => {
      let storedKey = this.mapStoredKey(wallet);
      let coin = (this.core.CoinType as any).values["" + account.coin];
      let privateKey = storedKey.privateKey(coin, Buffer.from(password));
      storedKey.delete();
      return privateKey;
    });
  }

  export(id: string, password: string): Promise<string | Uint8Array> {
    return this.load(id).then((wallet) => {
      let storedKey = this.mapStoredKey(wallet);
      let value: string | Uint8Array;
      switch (wallet.type) {
        case Types.WalletType.Mnemonic:
          value = storedKey.decryptMnemonic(Buffer.from(password));
          break;
        case Types.WalletType.PrivateKey:
          value = storedKey.decryptPrivateKey(Buffer.from(password));
          break;
        default:
          throw Types.Error.InvalidJSON;
      }
      storedKey.delete();
      return value;
    });
  }

  getWalletType(id: string): Promise<Types.WalletType> {
    return this.load(id).then((wallet) => wallet.type);
  }

  exportMnemonic(id: string, password: string): Promise<string> {
    return this.load(id).then((wallet) => {
      if (wallet.type !== Types.WalletType.Mnemonic) {
        throw Types.Error.UnsupportedWalletType;
      }
      let storedKey = this.mapStoredKey(wallet);
      let value = storedKey.decryptMnemonic(Buffer.from(password));
      storedKey.delete();
      return value;
    });
  }

  exportPrivateKey(id: string, password: string): Promise<Uint8Array> {
    return this.load(id).then((wallet) => {
      if (wallet.type !== Types.WalletType.PrivateKey) {
        throw Types.Error.UnsupportedWalletType;
      }
      let storedKey = this.mapStoredKey(wallet);
      let value = storedKey.decryptPrivateKey(Buffer.from(password));
      storedKey.delete();
      return value;
    });
  }

  exportPrivateKeyEncoded(id: string, password: string): Promise<string> {
    return this.load(id).then((wallet) => {
      if (wallet.type !== Types.WalletType.PrivateKey) {
        throw Types.Error.UnsupportedWalletType;
      }
      let storedKey = this.mapStoredKey(wallet);
      let value = storedKey.decryptPrivateKeyEncoded(Buffer.from(password));
      storedKey.delete();
      return value;
    });
  }
}
