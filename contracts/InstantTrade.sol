pragma solidity ^0.4.13;

import "./TokenStore.sol";

contract ZeroExchange {
    
    address public TOKEN_TRANSFER_PROXY_CONTRACT;
    
    function fillOrKillOrder(
        address[5] orderAddresses,
        uint[6] orderValues,
        uint fillTakerTokenAmount,
        uint8 v,
        bytes32 r,
        bytes32 s)
        public {}
        
  /*  function fillOrder(
          address[5] orderAddresses,
          uint[6] orderValues,
          uint fillTakerTokenAmount,
          bool shouldThrowOnInsufficientBalanceOrAllowance,
          uint8 v,
          bytes32 r,
          bytes32 s)
          public
          returns (uint filledTakerTokenAmount)
          {}
    */
}

contract WETH {
    function deposit() public payable {}
    function withdraw(uint wad) public {}
}

contract InstantTrade is SafeMath, Ownable {

    address public wETH;
    address public zeroX;
    address public proxyZeroX;
    
    mapping(address => bool) allowedFallbacks; // Limit fallback to avoid accidental ETH transfers
    
   constructor(address _weth, address _zeroX) Ownable() public {
       wETH = _weth;
       zeroX = _zeroX;
       proxyZeroX = ZeroExchange(zeroX).TOKEN_TRANSFER_PROXY_CONTRACT();
       
       allowedFallbacks[wETH] = true;
   }
   
  // Only allow incoming ETH from known contracts (Exchange and WETH withdrawals)
  function() public payable {
      require(allowedFallbacks[msg.sender]);
  }
  
  
  function allowFallback(address _contract, bool _allowed) external onlyOwner {
       allowedFallbacks[_contract] = _allowed;
   }
  
  function getTotalFeeValue(uint _amount) internal returns (uint) {
      return safeMul(_amount, 1004) / 1000;
  }
  
  
  
   // Sell erc20 tokens for ETH (Token Store, EtherDelta)
  function sellTokens(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive,
      uint _expires, uint _nonce, address _user, uint8 _v, bytes32 _r, bytes32 _s, uint _amount, address _store) external {
   
    uint totalValue = getTotalFeeValue(_amount);
      
    // Assuming user already approved transfer, transfer to this contract
    require(Token(_tokenGet).transferFrom(msg.sender, this, totalValue));

    // Deposit token to the exchange
    require(Token(_tokenGet).approve(_store, totalValue)); 
    TokenStore(_store).depositToken(_tokenGet, totalValue);
   
   
    // Wrap trade function in a call to avoid a 'throw;' using up all gas, returns (bool success)
    require(
        address(_store).call(
          bytes4(0x0a19b14a), // precalculated Hash of the line below
          //bytes4(keccak256("trade(address,uint256,address,uint256,uint256,uint256,address,uint8,bytes32,bytes32,uint256)")),  
          _tokenGet, _amountGet, _tokenGive, _amountGive,_expires, _nonce, _user, _v, _r, _s, _amount
        )
    );

    // Check how much did we get and how much should we send back
    totalValue = TokenStore(_store).balanceOf(_tokenGive, this);
    uint customerValue = safeMul(_amountGive, _amount) / _amountGet;
    
    // Now withdraw all the funds into this contract and then pass to the user
    TokenStore(_store).withdraw(totalValue);
    msg.sender.transfer(customerValue);
  }
  
   // Sell erc20 tokens for ETH (0x)
  function sellTokens0x(address[5] _orderAddresses, uint[6] _orderValues, uint8 _v, bytes32 _r, bytes32 _s, uint _amount) external {
    // require an undefined taker and 0 makerFee, 0 takerFee
    require(
      _orderAddresses[1] == address(0) 
      &&_orderValues[2] == 0 
      && _orderValues[3] == 0
    ); 
    

    // Fix max fee (0.4%) and always reserve it
    uint totalValue = getTotalFeeValue(_amount);
    
  
    // Assuming user already approved transfer, transfer to this contract
    require(Token(/*takerToken*/_orderAddresses[3]).transferFrom(msg.sender, this, totalValue));
    // Allow now actual store to deposit
    require(Token(/*takerToken*/_orderAddresses[3]).approve(proxyZeroX, totalValue)); 
    
    // Trade and require that it was the full amount
    ZeroExchange(zeroX).fillOrKillOrder(_orderAddresses, _orderValues, _amount, _v, _r, _s);

    
    // Check how much did we get and how much should we send back
    uint customerValue = safeMul(/*makerTokenAmount*/_orderValues[0], _amount) / /*takerTokenAmount*/_orderValues[1];
    
    // Now unwrap funds and send to user
    totalValue = Token(wETH).balanceOf(this);
    WETH(wETH).withdraw(totalValue);
    msg.sender.transfer(customerValue);
  }
  
   // Buy erc20 tokens for ETH (Token Store, EtherDelta)
  function buyTokens(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive,
      uint _expires, uint _nonce, address _user, uint8 _v, bytes32 _r, bytes32 _s, uint _amount, address _store) external payable {
    
    uint totalValue = getTotalFeeValue(_amount);
    require(msg.value == totalValue);
    TokenStore(_store).deposit.value(totalValue)();
    
    /*
    TokenStore(_store).trade(_tokenGet, _amountGet, _tokenGive, _amountGive,
      _expires, _nonce, _user, _v, _r, _s, _amount);
    */

    // Wrap trade function in a call to avoid a 'throw;' using up all gas, returns (bool success)
    require(
        address(_store).call(
          bytes4(0x0a19b14a), // precalculated Hash of the line below
          //bytes4(keccak256("trade(address,uint256,address,uint256,uint256,uint256,address,uint8,bytes32,bytes32,uint256)")),  
          _tokenGet, _amountGet, _tokenGive, _amountGive,_expires, _nonce, _user, _v, _r, _s, _amount
        )
    );
      
    
    // Check how much did we get and how much should we send back
    totalValue = TokenStore(_store).balanceOf(_tokenGive, this);
    uint customerValue = safeMul(_amountGive, _amount) / _amountGet;
    
    // Now withdraw all the funds into this contract and then pass to the user
    TokenStore(_store).withdrawToken(_tokenGive, totalValue);
    require(Token(_tokenGive).transfer(msg.sender, customerValue)); 
  }
  
  // Buy erc20 tokens for ETH (0x)
  function buyTokens0x(address[5] _orderAddresses, uint[6] _orderValues, uint8 _v, bytes32 _r, bytes32 _s, uint _amount) external payable {
    
    // require an undefined taker and 0 makerFee, 0 takerFee
    require(
      _orderAddresses[1] == address(0) 
      &&_orderValues[2] == 0 
      && _orderValues[3] == 0
    ); 

    // Fix max fee (0.4%) and always reserve it
     uint totalValue = getTotalFeeValue(_amount);
    
    // Check amount of ether sent to make sure it's correct
    require(msg.value == totalValue);
    // Convert to wrapped ETH
    WETH(wETH).deposit.value(msg.value)();
    require(Token(wETH).approve(proxyZeroX, msg.value)); 

    // Trade and require that it was the full amount
    ZeroExchange(zeroX).fillOrKillOrder(_orderAddresses, _orderValues, _amount, _v, _r, _s);

    // Check how much did we get and how much should we send back
    uint customerValue = safeMul(/*makerTokenAmount*/_orderValues[0], _amount) / /*takerTokenAmount*/_orderValues[1];
    require(Token(_orderAddresses[2]).transfer(msg.sender, customerValue));  
  }
  
  
  
  
  
  
  
  
  
  // End to end trading in a single call (Token Store, EtherDelta)
  function instantTrade(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive,
      uint _expires, uint _nonce, address _user, uint8 _v, bytes32 _r, bytes32 _s, uint _amount, address _store) external payable {
    
    // Fix max fee (0.4%) and always reserve it
    uint totalValue = getTotalFeeValue(_amount);
    
    // Paying with Ethereum or token? Deposit to the actual store
    if (_tokenGet == address(0)) {
      // Check amount of ether sent to make sure it's correct
      require(msg.value == totalValue);
      TokenStore(_store).deposit.value(totalValue)();
    } else {
      require(msg.value == 0);
        
      // Assuming user already approved transfer, transfer to this contract
      require(Token(_tokenGet).transferFrom(msg.sender, this, totalValue));

      // Deposit token to the exchange
      require(Token(_tokenGet).approve(_store, totalValue)); 
      TokenStore(_store).depositToken(_tokenGet, totalValue);
    }
    
    /*
    TokenStore(_store).trade(_tokenGet, _amountGet, _tokenGive, _amountGive,
      _expires, _nonce, _user, _v, _r, _s, _amount);
    */

    // Wrap trade function in a call to avoid a 'throw;'(EtherDelta) using up all gas, returns (bool success)
    require(
        address(_store).call(
          bytes4(0x0a19b14a), // precalculated Hash of the line below
          //bytes4(keccak256("trade(address,uint256,address,uint256,uint256,uint256,address,uint8,bytes32,bytes32,uint256)")),  
          _tokenGet, _amountGet, _tokenGive, _amountGive,_expires, _nonce, _user, _v, _r, _s, _amount
        )
    );

    
    // Check how much did we get and how much should we send back
    totalValue = TokenStore(_store).balanceOf(_tokenGive, this);
    uint customerValue = safeMul(_amountGive, _amount) / _amountGet;
    
    // Now withdraw all the funds into this contract and then pass to the user
    if (_tokenGive == address(0)) {
      TokenStore(_store).withdraw(totalValue);
      msg.sender.transfer(customerValue);
    } else {
      TokenStore(_store).withdrawToken(_tokenGive, totalValue);
      require(Token(_tokenGive).transfer(msg.sender, customerValue));
    }
  }
  
  
  // End to end trading in a single call (0x with undefined taker and no ZRX fees: RadarRelay)
  function instantTrade0x(address[5] _orderAddresses, uint[6] _orderValues, uint8 _v, bytes32 _r, bytes32 _s, uint _amount) external payable {
            
    // require an undefined taker and 0 makerFee, 0 takerFee
    require(
      _orderAddresses[1] == address(0) 
      &&_orderValues[2] == 0 
      && _orderValues[3] == 0
    ); 
    
    
    // Fix max fee (0.4%) and always reserve it
    uint totalValue = getTotalFeeValue(_amount);
    
    // Paying with (wrapped) Ethereum or  other token? 
    if (/*takerToken*/_orderAddresses[3] == wETH) {
        
      // Check amount of ether sent to make sure it's correct
      require(msg.value == totalValue);
       // Convert to wrapped ETH
      WETH(wETH).deposit.value(msg.value)();
      require(Token(wETH).approve(proxyZeroX, msg.value)); 
    } else {
        
      require(msg.value == 0);
      
      // Assuming user already approved transfer, transfer to this contract
      require(Token(/*takerToken*/_orderAddresses[3]).transferFrom(msg.sender, this, totalValue));

      // Allow now actual store to deposit
      require(Token(/*takerToken*/_orderAddresses[3]).approve(proxyZeroX, totalValue)); 
    } 
    
    // Trade and require that it was the full amount
    ZeroExchange(zeroX).fillOrKillOrder(_orderAddresses, _orderValues, _amount, _v, _r, _s);

    // Check how much did we get and how much should we send back
    uint customerValue = safeMul(/*makerTokenAmount*/_orderValues[0], _amount) / /*takerTokenAmount*/_orderValues[1];
    
    // Now unwrap funds and send to user
    if (/*makerToken*/_orderAddresses[2] == wETH) {
      totalValue = Token(wETH).balanceOf(this);
      WETH(wETH).withdraw(totalValue);
      msg.sender.transfer(customerValue);
    } else {
      require(Token(_orderAddresses[2]).transfer(msg.sender, customerValue));
    }  
  } 
  
  // Withdraw funds earned from fees
  function withdrawFees(address _token) external onlyOwner {
    if (_token == address(0)) {
      msg.sender.transfer(address(this).balance);
    } else {
      Token token = Token(_token);
      require(token.transfer(msg.sender, token.balanceOf(address(this))));
    }
  }  
}
