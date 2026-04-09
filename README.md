# Masterway – AI-Powered IO-Link Monitoring & Diagnostics Platform
An industrial-grade monitoring system that transforms IO-Link data into real-time insights, diagnostics, and predictive intelligence.

## Architecture

IO-Link Sensors  
    ↓  
IO-Link Master (ICE2 / ICE11)  
    ↓  
Modbus TCP  
    ↓  
FastAPI Backend (Data Processing & API)  
    ↓  
React Frontend (Monitoring UI & AI Diagnostics)

Masterway uses Modbus TCP as the primary communication protocol to directly interface with IO-Link Masters.
The backend continuously reads Process Data (PDI) from each port and processes it into structured data for visualization and AI-based diagnostics.

### Why Modbus TCP?

- Direct communication with IO-Link Master (no middleware required)
- Lightweight and reliable industrial protocol
- Easy integration with PLC and HMI systems
- Suitable for real-time monitoring environments

## System Concept

This system mimics a PLC-level data acquisition architecture, where:

- IO-Link Master acts as field gateway
- Modbus TCP replaces traditional PLC communication
- Backend acts as a virtual controller + analytics engine
