var Decethex = artifacts.require("./Decethex.sol");
var Token = artifacts.require("./Token.sol");

var sha256 = require('js-sha256').sha256;
var util = require('./util.js');
var async = require('async');

contract('Decethex', function(accounts) {

  var accs = accounts.slice(0, 4);
  const fee = 3000000000000000;
  const depositToken = 100000;
  const depositEther = 10000;
  const feeAccount = 3, tokenAccount = 3;
  const defaultExpirationInBlocks = 100;
  const failedTransactionError = "Error: VM Exception while processing transaction: invalid opcode";

  ///////////////////////////////////////////////////////////////////////////////////
  // Helper functions
  ///////////////////////////////////////////////////////////////////////////////////

  // Creates a test token and distributes among all test accounts
  function createAndDistributeToken(symbol, callback) {
    var token;
    return Token.new(depositToken*accounts.length, "TestToken", 3, symbol, {from: accounts[tokenAccount]}).then(function(instance) {
      token = instance;
    }).then(function(result) {
      return new Promise((resolve, reject) => {
        async.eachSeries(accounts,
          (account, callbackEach) => {
            token.transfer(account, depositToken, {from: accounts[tokenAccount]}).then(function(result) {
              callbackEach(null);
            });
          },
          () => {
            resolve(token);
          });
      });
    });
  }

  // Deposits a portion of the token to the exchange from all test accounts
  function depositTokenByAllAccounts(dec, token) {
    return new Promise((resolve, reject) => {
      async.eachSeries(accounts,
        (account, callbackEach) => {
          token.approve(dec.address, depositToken, {from: account}).then(function(result) {
            dec.depositToken(token.address, depositToken, {from: account}).then(function(result) {
              callbackEach(null);
            });
          },
          () => {
            resolve();
          });
        });
    });
  }
  
  // Deposit ether to the exchange from all test accounts
  function depositEtherByAllAccounts(dec) {
    return new Promise((resolve, reject) => {
      async.eachSeries(accs,
        (account, callbackEach) => {
          dec.deposit({from: account, value: depositEther}).then(function(result) {
            callbackEach(null);
          });
        },
        () => {
          resolve();
        });
    });
  }

  // Creates a bunch of tokens, distributes them, deposits ether and tokens
  // by all the participants to the exchange so we can test different operations
  function initialConfiguration() {
    var token1, token2;
    var dec;
    return Decethex.new(fee, {from: accounts[feeAccount]}).then(function(instance) {
      dec = instance;
      return createAndDistributeToken("TT1");
    }).then(function(instance) {
      token1 = instance;
      return createAndDistributeToken("TT2");
    }).then(function(instance) {
      token2 = instance;
      return depositTokenByAllAccounts(dec, token1);
    }).then(function(result) {
      return depositTokenByAllAccounts(dec, token2);
    }).then(function(result) {
      return depositEtherByAllAccounts(dec);
    }).then(function(result) {
      return {dec: dec, token1: token1, token2: token2};
    });
  }
  
  function executeChecks(checks) {
    return new Promise((resolve, reject) => {
      async.eachSeries(checks,
        (check, callbackEach) => {
          check().then(function(result) {
            callbackEach(null);
          });
        },
        () => {
          resolve();
        });
    });
  }
  
  function getBlockNumber() {
    return new Promise((resolve, reject) => {
      web3.eth.getBlockNumber((err, res) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    });
  }
  
  function signOrder(dec, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, expires, nonce) {
    const condensed = util.pack([
      dec.address,
      tokenGet,
      amountGet,
      tokenGive,
      amountGive,
      expires,
      nonce,
    ], [160, 160, 256, 160, 256, 256, 256]);
    const hash = sha256(new Buffer(condensed, 'hex'));
    return util.promisify(util.sign, [web3, creatorAddress, hash, ''])  
  }
  
  function executeOrder(dec, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, amountGiven, from, expire, nonce) {
    var realExpire;
    var realNonce = nonce || Math.floor(Math.random());
    return getBlockNumber().then(function(result) {
      realExpire = expire || result+defaultExpirationInBlocks;
      return signOrder(dec, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, realExpire, realNonce);
    }).then(function(result) {
      return dec.trade(tokenGet, amountGet, tokenGive, amountGive, realExpire,
          realNonce, creatorAddress, result.v, result.r, result.s, amountGiven, {from: from});
    });
  }
  
  ///////////////////////////////////////////////////////////////////////////////////
  // Tests functions
  ///////////////////////////////////////////////////////////////////////////////////
  
  it("Initial configuration should be valid", function() {

    return initialConfiguration().then(function(result) {
      var dec = result.dec;
      var token1 = result.token1;
      var token2 = result.token2;
      
      var checks = [
        function() { return dec.balanceOf.call(token1.address, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), depositToken, "Token #1 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(token2.address, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), depositToken, "Token #2 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(0, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), depositEther, "Ether deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(token1.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositToken, "Token #1 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(token2.address, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositToken, "Token #2 deposit for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(0, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), depositEther, "Ether deposit for acc #0 was not successful");
        }) },
        function() { return dec.fee.call().then(function(result) {
          assert.equal(result.toNumber().valueOf(), fee, "The fee is incorrect");
        }) }
      ];
      
      return executeChecks(checks);
    });    
  });

  // Note: this tests only Eth to Token but since we treat eth internally
  // as a token with 0 address, direction is not important. It can also be
  // Token to Token for that matter.
  it("Successful trade", function() {
  
    var dec;
    
    var tokenGet = 0;       // Eth as a token type
    var tokenGive;          // Token address for wanted token
    var amountGet = 2000;   // Eth wanted
    var amountGive = 10000; // Token given in return
    var amountGiven = 1000; // Ether given by a counter-party

    
    return initialConfiguration().then(function(result) {

      dec = result.dec;
      tokenGive = result.token1.address;

      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven, accounts[1]);

    }).then(function(result) {

      var checks = [
        function() { return dec.balanceOf.call(tokenGive, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 95000, "Token sale for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGive, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 105000, "Token purchase for acc #1 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[0]).then(function(result) {
          assert.equal(result.toNumber(), 11000, "Eth purchase for acc #0 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[1]).then(function(result) {
          assert.equal(result.toNumber(), 8997, "Eth sale for acc #1 was not successful");
        }) },
        function() { return dec.balanceOf.call(tokenGet, accounts[feeAccount]).then(function(result) {
          assert.equal(result.toNumber(), 10003, "Eth fee is incorrect");
        }) }
      ];

      return executeChecks(checks);
    });
  });
  
  it("Failed trades", function() {
  
    var dec;

    var tokenGet = 0;       // Eth as a token type
    var tokenGive;          // Other token type
    var amountGet = 2000;   // Eth wanted
    var amountGive = 10000; // Token given in return
    
    var fixedExpire = 1000000000; // High enough block number
    var fixedNonse = 0;

    return initialConfiguration().then(function(result) {
    
      dec = result.dec;
      tokenGive = result.token1.address;

      // Tries to buy more than total order request
      var amountGiven1 = 3000;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven1, accounts[1]);
    }).then(function(result) {
      assert.fail(); // Transaction passed, it should not
    }).catch(function(e) {
      assert.equal(e, failedTransactionError, "Error is not triggered");

      // Tries to offer more than the buyer has (using an account that didn't deposit)
      var amountGiven2 = 1000;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven2, accounts[accs.length]);
    }).then(function(result) {
      assert.fail();
    }).catch(function(e) {
      assert.equal(e, failedTransactionError, "Error is not triggered");

      // Oversubscribed order (multiple trades with overflowing total)
      var amountGiven31 = 1500;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven31, accounts[1], fixedExpire, fixedNonse);
    }).catch(function(e) {
      assert.fail(); // First transaction should pass, we're going to fail on a second
    }).then(function(result) {
      var amountGiven32 = 700;
      return executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven32, accounts[1], fixedExpire, fixedNonse);
    }).then(function(result) {
      assert.fail(); // Second transaction have passed, it should not
    }).catch(function(e) {
      assert.equal(e, failedTransactionError, "Blockchain error is not triggered");
    });
  });
    
  // TODO: Test migrations
  
  // TODO: Test more complex transactions (trades list)
  
  // TODO: Test account modifiers effects
  
  // TODO: Test Withdrawal of tokens and ether
});
