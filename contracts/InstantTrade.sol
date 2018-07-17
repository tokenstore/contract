pragma solidity ^0.4.13;

import "./TokenStore.sol";

contract InstantTrade is SafeMath, Ownable {

  // This is needed so we can withdraw funds from other smart contracts
  function() public payable {
  }
  
  // End to end trading in a single call
  function instantTrade(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive,
      uint _expires, uint _nonce, address _user, uint8 _v, bytes32 _r, bytes32 _s, uint _amount, address _store) external payable {
    
    // Fix max fee (0.4%) and always reserve it
    uint totalValue = safeMul(_amount, 1004) / 1000;
    
    // Paying with Ethereum or token? Deposit to the actual store
    if (_tokenGet == address(0)) {
      // Check amount of ether sent to make sure it's correct
      require(msg.value == totalValue);
      TokenStore(_store).deposit.value(totalValue)();
    } else {
      // Assuming user already approved transfer, transfer first to this contract
      require(Token(_tokenGet).transferFrom(msg.sender, this, totalValue));

      // Allow now actual store to deposit
      require(Token(_tokenGet).approve(_store, totalValue)); 
      TokenStore(_store).depositToken(_tokenGet, totalValue);
    }
    
    // Trade
    TokenStore(_store).trade(_tokenGet, _amountGet, _tokenGive, _amountGive,
      _expires, _nonce, _user, _v, _r, _s, _amount);
    
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
  
  function withdrawFees(address _token) external onlyOwner {
    if (_token == address(0)) {
      msg.sender.transfer(address(this).balance);
    } else {
      uint amount = Token(_token).balanceOf(address(this));
      require(Token(_token).transfer(msg.sender, amount));
    }
  }  
}
