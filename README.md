# TokenStore contracts and test suite

## Contracts
1. TokenStore.sol - key exchange contract with helpers
2. AccountModifiers.sol - a simple contract to hold fee/rebate modifiers
3. TokenTemplate.sol - a sample ERC20 token contract to be used in testing only

## Install
```
cd contract
npm install
truffle compile
truffle deploy
```

## Testing
1. Install [truffle](http://truffleframework.com/) 3.4.6
2. Install [testrpc](https://github.com/ethereumjs/testrpc) 3.9.2
2. Launch testrpc, unlocking first several accounts with `testrpc --secure -u 0 -u 1 -u 2 -u 3 -u 4`
3. Launch `truffle test` from command line

## Contact
Email us at tokendotstore@gmail.com with any questions and feedback!
